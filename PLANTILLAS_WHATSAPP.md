# Plantillas de WhatsApp (para leads fríos)

WhatsApp **solo permite texto libre dentro de las 24h** desde que el usuario te
escribe. Para leads nuevos de campañas (que nunca escribieron al bot) hay que
usar **plantillas aprobadas**. El bot ya las envía si configuras estas variables
de entorno en Railway; si no están, usa texto libre (sirve solo para números que
ya te escribieron).

## Reglas aprendidas (para que Meta no las rechace)
1. **Tipo de variable: `Número`** (NO "Nombre"). El bot manda variables por
   posición; si eliges "Nombre" el editor marca error con `{{1}}`.
2. **Las variables no pueden ir al principio ni al final** del cuerpo: siempre
   deja texto antes y después (por eso los cuerpos terminan con "¡Gracias!" etc).
3. **Evita la palabra "Código" (y "verificación", "OTP", etc.)**: Meta cree que
   es un código de autenticación y fuerza la categoría "Autenticación". Usamos
   "ref." en su lugar.
4. **Categoría: `Utility` (Utilidad)** funciona con estos textos. Si Meta sugiere
   otra categoría en verde, acéptala SALVO "Autenticación" (esa tiene formato
   especial y rompería el bot).
5. **Idioma:** anota el código exacto (Spanish = `es`, Spanish MEX = `es_MX`) y
   ponlo en `WHATSAPP_TEMPLATE_LANG`. Debe coincidir EXACTO al enviar.

## Plantilla 1 — Confirmación de solicitud
- **Nombre:** `solicitud_recibida_wa`
- **Categoría:** Utility · **Idioma:** Spanish (MEX) = `es_MX`
- **Cuerpo:**
  ```
  ¡Hola {{1}}! ✅ Recibimos tu solicitud de matrícula en {{2}} (ref. {{3}}). En breve un asesor te contactará para confirmar tu inscripción. ¡Gracias!
  ```
- **Variables:** `{{1}}`=nombre, `{{2}}`=ciclo/empresa, `{{3}}`=código (SOL-000123)
- **Ejemplo para Meta:** {{1}}=Jampier · {{2}}=CICLO ESCOLAR · {{3}}=SOL-000123

## Plantilla 2 — Matrícula aprobada
- **Nombre:** `matricula_aprobada_wa`
- **Categoría:** Utility · **Idioma:** Spanish (MEX) = `es_MX`
- **Cuerpo:**
  ```
  ¡Felicidades {{1}}! 🎉 Tu matrícula en {{2}} fue aprobada. Revisa tus horarios y cronograma de pagos en este enlace: {{3}} ¡Te esperamos!
  ```
- **Variables:** `{{1}}`=nombre, `{{2}}`=ciclo — canal — carrera, `{{3}}`=link público
- **Ejemplo para Meta:** {{1}}=Jampier · {{2}}=CICLO ESCOLAR - Canal 2 · {{3}}=https://matricula-publica.vercel.app/mi-matricula/abc123

## Variables de entorno en Railway (apiBotElite)
Una vez aprobadas:
```
WHATSAPP_TEMPLATE_CONFIRMACION=solicitud_recibida_wa
WHATSAPP_TEMPLATE_APROBACION=matricula_aprobada_wa
WHATSAPP_TEMPLATE_LANG=es_MX
MATRICULA_PUBLICA_URL=https://<tu-dominio-de-matricula-publica>
```
Sin estas variables el bot envía texto libre (solo entrega a números que ya
escribieron al bot en las últimas 24h).
