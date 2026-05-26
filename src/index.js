import "dotenv/config";
import express from "express";
import axios from "axios";
import mysql from "mysql2/promise";
import OpenAI from "openai";

const app = express();
app.use(express.json());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =====================================================================
   Webhook WhatsApp Cloud API (Meta)
   ===================================================================== */

/* GET → verificación */
app.get("/webhook", (req, res) => {
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* POST → recepción de mensajes entrantes */
app.post("/webhook", async (req, res) => {
  // Acusamos recibo a Meta de inmediato para que no reintente (los reintentos
  // generan mensajes duplicados). El agente procesa en segundo plano.
  res.sendStatus(200);

  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return;

    const from = change.contacts[0].wa_id;
    const text = msg.text?.body ?? "";
    if (!text.trim()) return;

    await responderConAgente(from, text);
  } catch (error) {
    console.error("Error en webhook →", error.response?.data ?? error.message);
  }
});

/* =====================================================================
   Agente conversacional (OpenAI tool calling)
   El modelo redacta la respuesta con naturalidad y consulta datos reales
   de la academia mediante "herramientas" (ciclos, pagos, etc.).
   ===================================================================== */

// Memoria de conversación por número: últimos turnos (en memoria, suficiente
// para conversaciones activas; se pierde si Railway reinicia).
const HISTORIAL_MAX = 10;
const historiales = new Map(); // wa_id -> [{ role, content }]

function systemPrompt(nombreEmpresa) {
  return `Eres "Élite Bot", el asistente virtual de la academia preuniversitaria ${nombreEmpresa}, atendiendo por WhatsApp a futuros alumnos y apoderados.

Tono: cálido, cercano y profesional, en español peruano. Respuestas CORTAS (2 a 5 líneas). Usa emojis con moderación.

Formato OBLIGATORIO de WhatsApp (no es Markdown):
- Negritas con UN solo asterisco: *texto*. NUNCA uses doble asterisco **texto**.
- Los enlaces van como URL cruda (https://...), NUNCA en formato [texto](url).

Cómo trabajas:
- Tienes herramientas para consultar datos reales de la academia (datos generales, ciclos y precios, link de inscripción, métodos de pago). Úsalas cuando las necesites en lugar de suponer.
- Usa SOLO la información que devuelven las herramientas. NUNCA inventes precios, fechas, horarios ni promociones.
- Si te preguntan algo que no puedes responder con tus herramientas, dilo con naturalidad y ofrece que un asesor lo contacte.
- No muestres un "menú" rígido; conversa de forma natural y guía al usuario a inscribirse cuando tenga sentido.
- Si el usuario quiere inscribirse, dale el link. Si pregunta cómo o dónde pagar, envíale los métodos de pago.`;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "datos_empresa",
      description:
        "Datos generales de la academia: nombre, dirección, beneficios, email y WhatsApp de contacto. Úsalo para saludos, ubicación, beneficios o información general.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_ciclos",
      description:
        "Lista los ciclos disponibles ahora con sus precios de matrícula y mensualidad (presencial y virtual). Úsalo cuando pregunten por ciclos, precios, costos o cuándo empieza.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "link_inscripcion",
      description:
        "Devuelve el enlace para inscribirse/matricularse online. Úsalo cuando el usuario quiera inscribirse o matricularse.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "enviar_metodos_pago",
      description:
        "Envía al usuario las imágenes de los métodos de pago (cuentas, Yape, etc.) y devuelve sus descripciones. Úsalo cuando pregunten cómo o dónde pagar.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

async function ejecutarHerramienta(name, _args, from) {
  switch (name) {
    case "datos_empresa": {
      const cfg = await getConfiguracion();
      return {
        nombre: cfg?.nombre_empresa || null,
        direccion: cfg?.direccion_principal || null,
        beneficios: cfg?.beneficios || null,
        email: cfg?.email_contacto || null,
        whatsapp: cfg?.whatsapp_contacto || null,
      };
    }
    case "listar_ciclos": {
      const ciclos = await getCiclosActivos();
      if (!ciclos.length) return { ciclos: [], nota: "No hay ciclos disponibles por ahora." };
      return {
        moneda: "PEN (S/)",
        ciclos: ciclos.map((c) => ({
          nombre: c.nombre,
          inicio: c.fecha_inicio ? new Date(c.fecha_inicio).toLocaleDateString("es-PE") : null,
          fin: c.fecha_fin ? new Date(c.fecha_fin).toLocaleDateString("es-PE") : null,
          presencial: {
            matricula: Number(c.montoMatriculaPresencial || 0),
            mensualidad: Number(c.montoMensualidadPresencial || 0),
          },
          virtual: {
            matricula: Number(c.montoMatriculaVirtual || 0),
            mensualidad: Number(c.montoMensualidadVirtual || 0),
          },
        })),
      };
    }
    case "link_inscripcion":
      return {
        url: process.env.MATRICULA_PUBLICA_URL || "https://matricula-publica.vercel.app/",
      };
    case "enviar_metodos_pago": {
      const imgs = await getMetodosPagoImagenes();
      for (const img of imgs) {
        try {
          await sendImage(from, img.url, img.descripcion || undefined);
        } catch (e) {
          console.error("img pago →", e.message);
        }
      }
      return {
        enviadas: imgs.length,
        metodos: imgs.map((i) => i.descripcion).filter(Boolean),
        nota: imgs.length
          ? "Imágenes de pago ya enviadas al usuario."
          : "No hay métodos de pago configurados; ofrece contactar a un asesor.",
      };
    }
    default:
      return { error: "herramienta desconocida" };
  }
}

async function responderConAgente(from, text) {
  const cfg = await getConfiguracion();
  const nombreEmpresa = cfg?.nombre_empresa || "la academia";

  const historial = historiales.get(from) || [];
  const messages = [
    { role: "system", content: systemPrompt(nombreEmpresa) },
    ...historial,
    { role: "user", content: text },
  ];

  let respuestaFinal = null;
  // Hasta 4 vueltas: el modelo puede pedir herramientas y luego redactar.
  for (let i = 0; i < 4; i++) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });
    const m = completion.choices[0].message;
    messages.push(m);

    if (m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        let args = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        const result = await ejecutarHerramienta(tc.function.name, args, from);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      continue; // volver a consultar al modelo con los resultados
    }

    respuestaFinal = m.content;
    break;
  }

  if (respuestaFinal && respuestaFinal.trim()) {
    await sendTextUrl(from, respuestaFinal.trim());
  }

  // Persistir solo los turnos de texto (no las llamadas a herramientas).
  const nuevoHist = [...historial, { role: "user", content: text }];
  if (respuestaFinal) nuevoHist.push({ role: "assistant", content: respuestaFinal });
  historiales.set(from, nuevoHist.slice(-HISTORIAL_MAX));
}

/* =====================================================================
   Endpoint interno para notificaciones del sistema
   Lo llama el backend Adonis cuando llega una solicitud de matrícula nueva.
   Lee el número de notificaciones de la tabla `configuracion` (BD compartida)
   y envía un WhatsApp con los datos.
   ===================================================================== */

app.post("/notify-solicitud", async (req, res) => {
  // Token interno simple para evitar que cualquiera pegue al endpoint
  const token = req.headers["x-internal-token"];
  if (token !== process.env.NOTIFY_INTERNAL_TOKEN) {
    return res.status(401).json({ ok: false, error: "no autorizado" });
  }

  // Responder de inmediato para que el backend no espere (evita el 499 por
  // timeout). El envío del WhatsApp se hace en segundo plano.
  res.status(202).json({ ok: true, queued: true });

  // Trabajo en background: no bloquea la respuesta ya enviada arriba.
  ;(async () => {
    try {
      const cfg = await getConfiguracion(); // una sola consulta a la BD
      const numero = cfg?.whatsapp_notificaciones || null;
      if (!numero) {
        console.warn("notify-solicitud → sin número de notificaciones configurado");
        return;
      }

      const mensaje = await construirMensajeSolicitud({ ...req.body, _cfg: cfg });
      await sendText(numero, mensaje);
      console.log(`notify-solicitud → WhatsApp (admin) enviado a ${numero}`);
    } catch (err) {
      console.error("notify-solicitud admin error →", err.response?.data ?? err.message);
    }

    // Confirmación al CLIENTE que dejó su número en la matrícula pública.
    // Va aparte: si falla (p. ej. número fuera de la ventana de 24h de Meta),
    // no afecta la notificación al admin.
    try {
      const cfg = await getConfiguracion();
      const destino = normalizarTelefonoPeru(req.body.whatsapp);
      if (destino) {
        const msgCliente = construirMensajeCliente({ ...req.body, _cfg: cfg });
        await sendText(destino, msgCliente);
        console.log(`notify-solicitud → WhatsApp (cliente) enviado a ${destino}`);
      }
    } catch (err) {
      console.error("notify-solicitud cliente error →", err.response?.data ?? err.message);
    }
  })();
});

/* Health */
app.get("/", (_req, res) => res.json({ ok: true, service: "apiBotElite" }));

/* =====================================================================
   Helpers WhatsApp Cloud API
   ===================================================================== */

async function sendText(to, body) {
  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
      }
    );
    return data;
  } catch (err) {
    console.error("WA error →", err.response?.data ?? err.message);
    throw err;
  }
}

async function sendTextUrl(to, body) {
  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: true, body },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
      }
    );
    return data;
  } catch (err) {
    console.error("WA error →", err.response?.data ?? err.message);
    throw err;
  }
}

/* =====================================================================
   Helpers de texto / queries
   ===================================================================== */

async function getCiclosActivos() {
  try {
    const conn = await pool();
    const [rows] = await conn.query("SELECT * FROM ciclos WHERE status = 1");
    return rows;
  } catch (e) {
    console.error("getCiclosActivos →", e.message);
    return [];
  }
}

async function construirMensajeSolicitud({
  nombre,
  apellido,
  dni,
  whatsapp,
  ciclo,
  modalidad,
  turno,
  sede,
  solicitudId,
  _cfg,
}) {
  const cfg = _cfg || (await getConfiguracion());
  const adminUrl = (cfg?.admin_url || "").trim();

  const lineas = [
    "📝 *Nueva solicitud de matrícula*",
    "",
    `*Solicitante:* ${nombre || ""} ${apellido || ""}`.trim(),
  ];
  if (dni) lineas.push(`*DNI:* ${dni}`);
  if (whatsapp) lineas.push(`*WhatsApp:* ${whatsapp}`);
  if (ciclo) lineas.push(`*Ciclo:* ${ciclo}`);
  if (modalidad)
    lineas.push(`*Modalidad:* ${modalidad}${turno ? " — " + turno : ""}`);
  if (sede) lineas.push(`*Sede:* ${sede}`);
  if (solicitudId)
    lineas.push(`*Código:* SOL-${String(solicitudId).padStart(6, "0")}`);
  lineas.push("");
  if (adminUrl) {
    const url = `${adminUrl.replace(/\/$/, "")}/solicitudes-matricula/${solicitudId}`;
    lineas.push(`👉 Ver en sistema: ${url}`);
  } else {
    lineas.push("Revisa la solicitud en el sistema para aprobarla.");
  }
  return lineas.join("\n");
}

/**
 * Mensaje de confirmación que recibe el CLIENTE que llenó la matrícula pública.
 */
function construirMensajeCliente({
  nombre,
  ciclo,
  modalidad,
  turno,
  sede,
  solicitudId,
  _cfg,
}) {
  const empresa = _cfg?.nombre_empresa || "nuestra academia";
  const lineas = [
    `¡Hola ${nombre || ""}! 👋`.trim(),
    "",
    `✅ Recibimos tu *solicitud de matrícula* en *${empresa}*.`,
  ];
  if (ciclo)
    lineas.push(
      `📘 Ciclo: *${ciclo}*${modalidad ? ` (${modalidad}${turno ? " — " + turno : ""})` : ""}`
    );
  if (sede) lineas.push(`📍 Sede: ${sede}`);
  if (solicitudId)
    lineas.push(`🧾 Código: *SOL-${String(solicitudId).padStart(6, "0")}*`);
  lineas.push("");
  lineas.push(
    "En breve un asesor te contactará por este medio para confirmar tu matrícula. ¡Gracias por elegirnos! 🎓"
  );
  return lineas.join("\n");
}

/**
 * Normaliza un teléfono a formato internacional E.164 sin '+' para WhatsApp.
 * Para Perú: un celular de 9 dígitos que empieza en 9 se prefija con 51.
 * Devuelve null si no parece un número válido.
 */
function normalizarTelefonoPeru(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/\D/g, "");
  if (!n) return null;
  if (n.length === 9 && n.startsWith("9")) n = "51" + n; // celular PE sin código país
  // Si ya viene con 51 y 11 dígitos, o es otro formato internacional, se deja.
  if (n.length < 8) return null;
  return n;
}

/* =====================================================================
   BD compartida
   ===================================================================== */

let _pool;
function pool() {
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    waitForConnections: true,
  });
  return _pool;
}

async function getConfiguracion() {
  try {
    const conn = await pool();
    const [rows] = await conn.query(
      "SELECT * FROM configuracion WHERE id = 1 LIMIT 1"
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function getWhatsappNotificaciones() {
  const cfg = await getConfiguracion();
  return cfg?.whatsapp_notificaciones || null;
}

async function getMetodosPagoImagenes() {
  // Pedimos al backend para obtener URLs firmadas vivas
  try {
    const baseUrl = process.env.BACKEND_PUBLIC_URL || "http://localhost:4336";
    const res = await axios.get(
      `${baseUrl.replace(/\/$/, "")}/api/public/metodos-pago-imagenes`,
      { timeout: 5000 }
    );
    return res.data?.data || [];
  } catch {
    return [];
  }
}

async function sendImage(to, link, caption) {
  return axios.post(
    `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: caption ? { link, caption } : { link },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    }
  );
}

/* =====================================================================
   Bootstrap
   ===================================================================== */

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`🚀 API WhatsApp/Bot escuchando en :${PORT}`)
);
