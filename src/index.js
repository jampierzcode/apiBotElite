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
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!change?.messages) {
      return res.status(200).json({ ok: true, msg: "No hay mensajes" });
    }

    const msg = change.messages[0];
    const from = change.contacts[0].wa_id;
    const text = msg.text?.body ?? "";

    // Clasificar intención con OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `En base a esta intención del usuario: "${text}"

          Clasifica la intencion en uno de estos tipos:

          "Inscripciones"
          "Información o Saludo"
          "Información de Ubicacion"
          "Beneficios"
          "Ciclos Aperturados"
          "Ciclos Para FASE I"
          "Ciclos Para FASE II"
          "Historial de pagos realizados con documento"
          "Historial de pagos realizados sin documento"
          "Renovar pago sin documento de identidad"
          "Renovar pago con documento de identidad"

          📤 IMPORTANTE: Devuelve ÚNICAMENTE un JSON válido con esta estructura:

          {
            "tipo_mensaje": "uno de los tipos anteriores",
            "documento": "puede ser vacío o el número si lo menciona"
          }
          `,
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
    });

    const { tipo_mensaje, documento } = JSON.parse(
      completion.choices[0].message.content
    );

    let respuesta;
    switch (tipo_mensaje) {
      case "Información de Ubicacion":
      case "Información o Saludo":
        respuesta = await sendText(from, await saludoMenu());
        break;
      case "Inscripciones":
        await sendTextUrl(from, await linkInscripcion());
        try {
          const imagenes = await getMetodosPagoImagenes();
          for (const img of imagenes) {
            await sendImage(from, img.url, img.descripcion || undefined);
          }
        } catch (e) {
          console.error("Error enviando imágenes de pago →", e.message);
        }
        respuesta = { ok: true, msg: "Inscripciones enviadas" };
        break;
      case "Beneficios":
        respuesta = await sendText(from, await beneficiosTexto());
        break;
      case "Ciclos Aperturados":
      case "Ciclos Para FASE I":
      case "Ciclos Para FASE II":
        respuesta = await handleGetCiclos(from);
        break;
      // Renovación de pagos: pendiente de implementación (Fase C)
      case "Renovar pago sin documento de identidad":
      case "Renovar pago con documento de identidad":
      case "Historial de pagos realizados con documento":
      case "Historial de pagos realizados sin documento":
        respuesta = await sendText(
          from,
          "Por ahora la renovación de pagos en línea no está disponible. Acércate a la academia o escribe a un asesor."
        );
        void documento;
        break;
      default:
        respuesta = await sendText(from, "No logré entender tu solicitud 🤖");
    }

    res.status(200).json({ ok: true, respuesta });
  } catch (error) {
    console.error("Error en webhook →", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

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

  try {
    const {
      nombre,
      apellido,
      dni,
      whatsapp,
      ciclo,
      modalidad,
      turno,
      sede,
      solicitudId,
    } = req.body;

    const numero = await getWhatsappNotificaciones();
    if (!numero) {
      return res.status(200).json({
        ok: false,
        warning: "Sin número de notificaciones configurado",
      });
    }

    const mensaje = await construirMensajeSolicitud({
      nombre,
      apellido,
      dni,
      whatsapp,
      ciclo,
      modalidad,
      turno,
      sede,
      solicitudId,
    });

    const data = await sendText(numero, mensaje);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("notify-solicitud error →", err.response?.data ?? err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
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

async function linkInscripcion() {
  const url = process.env.MATRICULA_PUBLICA_URL || "";
  if (url) {
    return `Claro que sí, te redirijo al enlace para tu inscripción:\n${url}`;
  }
  return "Acércate a la academia para inscribirte. Pronto tendremos el enlace de inscripción en línea.";
}

async function beneficiosTexto() {
  const cfg = await getConfiguracion();
  if (cfg?.beneficios && cfg.beneficios.trim()) return cfg.beneficios.trim();
  return "Pronto compartiremos contigo los beneficios de estudiar en nuestra academia.";
}

async function saludoMenu() {
  const cfg = await getConfiguracion();
  const nombre = cfg?.nombre_empresa || "ÉLITE";
  const direccion = cfg?.direccion_principal || "";
  return `🙌 Hola, bienvenido al EduBot de *${nombre}*. Tenemos las siguientes opciones:

- *Beneficios*
- *Solicitar inscripción*
- *Renovar pago*

🟢 DIRECCIÓN: ${direccion || "consulta nuestras sedes"}`;
}

async function handleGetCiclos(to) {
  const conn = await pool();
  const [rows] = await conn.query("SELECT * FROM ciclos WHERE status = 1");
  if (!rows.length) {
    return sendText(to, "Aún no tenemos ciclos disponibles.");
  }

  let mensaje = "👋 Hola, tenemos los siguientes ciclos aperturados:\n\n";
  rows.forEach((ciclo, index) => {
    mensaje += `📘 *${(ciclo.nombre || "").toUpperCase()}*\n`;
    if (ciclo.fecha_inicio)
      mensaje += `📅 Inicio: ${new Date(ciclo.fecha_inicio).toLocaleDateString("es-PE")}\n`;
    if (ciclo.fecha_fin)
      mensaje += `📅 Fin: ${new Date(ciclo.fecha_fin).toLocaleDateString("es-PE")}\n\n`;
    mensaje += `*Modalidades:*\n`;
    mensaje += `🏫 *Presencial*\n`;
    mensaje += `• Matrícula: S/ ${Number(ciclo.montoMatriculaPresencial || 0).toFixed(2)}\n`;
    mensaje += `• Mensualidad: S/ ${Number(ciclo.montoMensualidadPresencial || 0).toFixed(2)}\n\n`;
    mensaje += `💻 *Virtual*\n`;
    mensaje += `• Matrícula: S/ ${Number(ciclo.montoMatriculaVirtual || 0).toFixed(2)}\n`;
    mensaje += `• Mensualidad: S/ ${Number(ciclo.montoMensualidadVirtual || 0).toFixed(2)}\n`;
    if (index !== rows.length - 1) mensaje += `\n──────────────────────\n\n`;
  });
  mensaje += `\n✨ ¡Inscríbete ya!\n👉 https://inscripciones.academiapreuniversitariaelite.com/`;

  return sendTextUrl(to, mensaje);
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
}) {
  const cfg = await getConfiguracion();
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
