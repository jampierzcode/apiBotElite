import "dotenv/config";
import express from "express";
import axios from "axios";
import mysql from "mysql2/promise";
import OpenAI from "openai";

const app = express();
app.use(express.json());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* 3.1 Verificación de Webhook (GET) */
app.get("/webhook", (req, res) => {
  console.log(req.query);
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;
  console.log(mode, token, challenge);

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* 3.2 Recepción de mensajes (POST) */
app.post("/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!change?.messages) {
      return res.status(200).json({ ok: true, msg: "No hay mensajes" });
    }

    const msg = change.messages[0];
    const from = change.contacts[0].wa_id;
    const text = msg.text?.body ?? "";
    console.log(msg, from, text);

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
    
          📤 IMPORTANTE: Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta:
    
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
    console.log(tipo_mensaje, documento);

    let respuesta;

    switch (tipo_mensaje) {
      case "Información de Ubicacion":
        respuesta = await sendText(from, saludoMenu());
        break;
      case "Información o Saludo":
        respuesta = await sendText(from, saludoMenu());
        break;
      case "Inscripciones":
        await sendTextUrl(from, linkInscripcion());
        await sendImage(
          from,
          "https://inscripciones.academiapreuniversitariaelite.com/images/mediopagoelite1.jpeg"
        );
        await sendImage(
          from,
          "https://inscripciones.academiapreuniversitariaelite.com/images/mediopagoelite2.jpeg"
        );
        respuesta = { ok: true, msg: "Inscripciones enviadas" };
        break;
      case "Beneficios":
        respuesta = await sendText(from, beneficiosTexto());
        break;
      case "Renovar pago sin documento de identidad":
        respuesta = await sendText(from, pedirDocumentoTexto());
        break;
      case "Renovar pago con documento de identidad":
        respuesta = await handleRenovacion(documento, from);
        break;
      case "Ciclos Aperturados":
        respuesta = await handleGetCiclos(from);
        break;
      case "Ciclos Para FASE I":
        respuesta = await handleGetCiclos(from);
        break;
      case "Ciclos Para FASE II":
        respuesta = await handleGetCiclos(from);
        break;
      default:
        respuesta = await sendText(from, "No logré entender tu solicitud 🤖");
    }

    // Ahora sí respondemos a quien hizo la petición
    res.status(200).json({ ok: true, respuesta });
  } catch (error) {
    console.error("Error en webhook →", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* 3.3 Endpoints de formularios (POST) */
app.post("/form/inscripciones", async (req, res) => {
  const data = req.body; // mismo JSON que envías desde tu landing
  const conn = await pool(); // función pool() definida abajo
  const [result] = await conn.query("INSERT INTO persons SET ?", {
    nombres: data.nombres,
    apellidos: data.apellidos,
    numero_whatsapp:
      data.celular.length === 9 ? `51${data.celular}` : data.celular,
    correo: data.correo,
    status: data.status,
    documento: data.documento,
  });
  // Insertar matrícula, pagos, etc. igual que en tu flujo n8n
  await sendText(data.celular, `✅ Felicitaciones ${data.nombres}…`);
  res.json({ ok: true });
});

/* ---------------- Utils ---------------- */

async function sendText(to, body) {
  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to, // 5215512345678  (E.164, sin +)
        type: "text",
        text: {
          preview_url: false,
          body: body,
        },
      },
      {
        headers: {
          "Content-Type": "application/json", // OBLIGATORIO
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
      }
    );
    return data;
  } catch (err) {
    console.error("WA error →", err.response?.data ?? err.message);
    throw err; // haz que burbujee
  }
}
async function sendTextUrl(to, body) {
  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to, // 5215512345678  (E.164, sin +)
        type: "text",
        text: {
          preview_url: true,
          body: body,
        },
      },
      {
        headers: {
          "Content-Type": "application/json", // OBLIGATORIO
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
      }
    );

    console.log("WA response →", data);
    return data;
  } catch (err) {
    console.error("WA error →", err.response?.data ?? err.message);
    throw err; // haz que burbujee
  }
}

async function sendImage(to, link) {
  return axios.post(
    `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link },
    },
    {
      headers: {
        "Content-Type": "application/json", // OBLIGATORIO
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    }
  );
}

function saludoMenu() {
  /* tu texto */
  return `
  🙌Hola Bienvenido al EduBot de ÉLITE tenemos las siguientes opciones para tí:

- *Beneficios*
- *Solicitar una inscripcion*
- *Renovar Pago de mensualidad*

🟢 DIRECCIÓN:
 CALLE BOLIVAR  #347(4 casas más arriba del colegio de abogados) 
2DA SEDE: CALLE BOLIVAR #294 (a espaldas de la genovesa o al costado de la cámara de comercio)
  `;
}
function linkInscripcion() {
  return `Claro que si te estaremos redirigiendo a este enlace para tu suscripcion:
https://inscripciones.academiapreuniversitariaelite.com/
`;
}
function beneficiosTexto() {
  return `
    💪📚 CALIDAD Y EXPERIENCIA....UNETE YA!!!
🟢BENEFICIOS y VENTAJAS DE ESTUDIAR EN LA ACADEMIA ÉLITE:
🛑Exámenes simulacros semanales                                                                                  🛑Acceso a un drive:
✔️Prácticas
✔️Solucionarios
✔️Clases grabadas

🛑Acceso a libros con teoria y practicas para entrenar (digital)
🛑Profesores especialistas por cada curso
🛑Desarrollo de cursos segun tu canal.
🛑Tutoría y Mentoría
🛑Préstamo de libros para estudiar en casa con tu DNI
  `;
}
function pedirDocumentoTexto() {
  return `
    Hola🙋🏻‍♀️ para renovar tu pago es necesario que nos envíes tu *DOCUMENTO DE IDENTIDAD*
EJEMPLO: DNI(8digitos) o CARNET DE EXTRANJERÍA(hasta 20 dígitos)
  `;
}

async function handleRenovacion(documento, to) {
  const conn = await pool();
  const [rows] = await conn.query(/* tu SELECT complejo */);
  if (!rows.length) return sendText(to, pedirDocumentoTexto());

  const estado = rows[0].estado_pago;
  if (estado === "Al día") return sendText(to, "✅ Tus pagos están al día.");
  if (estado === "En deuda (pago vencido)")
    return sendText(
      to,
      `⚠️ Toca renovar aquí: https://.../renovaciones?documento=${documento}`
    );
}
async function handleGetCiclos(to) {
  const conn = await pool();
  const [rows] = await conn.query("SELECT * FROM ciclos WHERE status = 1");
  console.log(rows);
  if (!rows.length) {
    return sendText(to, "Aún no tenemos cursos disponibles.");
  }

  // Armamos el mensaje
  let mensaje =
    "👋 Hola, tenemos los siguientes ciclos aperturados para ti:\n\n";

  rows.forEach((ciclo, index) => {
    mensaje += `📘 *${ciclo.nombre.toUpperCase()}*\n`;
    mensaje += `📅 Inicio: ${new Date(ciclo.fecha_inicio).toLocaleDateString(
      "es-PE"
    )}\n`;
    mensaje += `📅 Fin: ${new Date(ciclo.fecha_fin).toLocaleDateString(
      "es-PE"
    )}\n\n`;

    mensaje += `*Modalidades:*\n`;
    mensaje += `🏫 *Presencial*\n`;
    mensaje += `• Matrícula: S/ ${Number(
      ciclo.montoMatriculaPresencial
    ).toFixed(2)}\n`;
    mensaje += `• Mensualidad: S/ ${Number(
      ciclo.montoMensualidadPresencial
    ).toFixed(2)}\n\n`;

    mensaje += `💻 *Virtual*\n`;
    mensaje += `• Matrícula: S/ ${Number(ciclo.montoMatriculaVirtual).toFixed(
      2
    )}\n`;
    mensaje += `• Mensualidad: S/ ${Number(
      ciclo.montoMensualidadVirtual
    ).toFixed(2)}\n`;

    // Separador entre ciclos
    if (index !== rows.length - 1) {
      mensaje += `\n──────────────────────\n\n`;
    }
  });
  // 👉 Incentivo final
  mensaje += `\n✨ ¡No pierdas tu lugar! Regístrate ahora en el siguiente enlace:\n👉 https://inscripciones.academiapreuniversitariaelite.com/`;

  return sendTextUrl(to, mensaje);
}

let _pool;
function pool() {
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    waitForConnections: true,
  });
  return _pool;
}

/* 3.4 Lanzar servidor */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("🚀 API WhatsApp corriendo en puerto", PORT)
);
