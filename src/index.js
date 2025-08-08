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
  res.sendStatus(200); // Acknowledge rápido
  const change = req.body?.entry?.[0]?.changes?.[0]?.value;
  if (!change?.messages) return;

  const msg = change.messages[0];
  const from = change.contacts[0].wa_id;
  const text = msg.text?.body ?? "";
  console.log(msg, from, text);
  /* 3.2.1 Clasificar intención con OpenAI (idéntico a tu prompt) */
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `En base a esta intención del usuario: "${text}"

        Clasifica la intencion en uno de estos tipos:

        "Inscripciones"

        "Información o Saludo"

        "Beneficios"

        "Ciclos Aperturados"

        "Historial de pagos realizados con documento"

        "Historial de pagos realizados sin documento"

        "Renovar pago sin documento de identidad"

        "Renovar pago con documento de identidad"

        📤 Si el mensaje coincide con alguno de estos tipos, devuelve un objeto JSON con esta estructura:

        {
          "tipo_mensaje": "tipo de mensaje identificado tal cual señalado arriba", "documento": "puede ser vacio o no, dependiendo de si envía el documento"
        }


        respondele porfavor, el tipo_mesaje y lo que quieras decirle tu`,
      }, // tu prompt completo aquí
      { role: "user", content: text },
    ],
    response_format: { type: "json_object" },
  });
  const { tipo_mensaje, documento } = JSON.parse(
    completion.choices[0].message.content
  );
  console.log(tipo_mensaje, documento);

  /* 3.2.2 Despachar según intención */
  switch (tipo_mensaje) {
    case "Información o Saludo":
      await sendText(from, saludoMenu());
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
      break;
    case "Beneficios":
      await sendText(from, beneficiosTexto());
      break;
    case "Renovar pago sin documento de identidad":
      await sendText(from, pedirDocumentoTexto());
      break;
    case "Renovar pago con documento de identidad":
      await handleRenovacion(documento, from);
      break;
    /* ...los demás casos... */
    default:
      await sendText(from, "No logré entender tu solicitud 🤖");
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

    console.log("WA response →", data);
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

-*Beneficios*
-*Solicitar una inscripcion*
-*Renovar Pago de mensualidad*

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
  // etc.
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
