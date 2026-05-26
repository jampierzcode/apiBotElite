# Plantillas de WhatsApp (para leads fríos)

WhatsApp **solo permite texto libre dentro de las 24h** desde que el usuario te
escribe. Para leads nuevos de campañas (que nunca escribieron al bot) hay que
usar **plantillas aprobadas**. El bot ya las envía si configuras estas variables
de entorno en Railway; si no están, usa texto libre (sirve solo para números que
ya te escribieron).

## Cómo crearlas
1. Entra a **WhatsApp Manager → Cuentas de WhatsApp Business → Plantillas de mensajes**.
2. Crea cada plantilla con categoría **Utility (Utilidad)**.
3. **Tipo de variable: `Número`** (NO "Nombre"). El bot manda variables por
   posición; si eliges "Nombre" el editor marca error con `{{1}}`.
4. **Idioma:** anota el código exacto que elijas (p. ej. "Spanish" = `es`,
   "Spanish (MEX)" = `es_MX`) y ponlo en `WHATSAPP_TEMPLATE_LANG` en Railway.
5. Pega el cuerpo tal cual (variables `{{1}}`, `{{2}}`, `{{3}}`).
6. Cuando Meta las apruebe, pon el nombre de cada una en Railway.

## Plantilla 1 — Confirmación de solicitud
- **Nombre sugerido:** `solicitud_recibida`
- **Categoría:** Utility · **Idioma:** es
- **Cuerpo:**
  ```
  ¡Hola {{1}}! ✅ Recibimos tu solicitud de matrícula en {{2}}. En breve un asesor te contactará para confirmar. Código: {{3}}
  ```
- **Variables:** `{{1}}`=nombre, `{{2}}`=ciclo/empresa, `{{3}}`=código (SOL-000123)
- **Ejemplo para Meta:** {{1}}=Jampier · {{2}}=CICLO ESCOLAR · {{3}}=SOL-000123

## Plantilla 2 — Matrícula aprobada
- **Nombre sugerido:** `matricula_aprobada`
- **Categoría:** Utility · **Idioma:** es
- **Cuerpo:**
  ```
  ¡Felicidades {{1}}! 🎉 Tu matrícula en {{2}} fue aprobada. Revisa tus horarios y cronograma de pagos aquí: {{3}}
  ```
- **Variables:** `{{1}}`=nombre, `{{2}}`=ciclo — canal — carrera, `{{3}}`=link público
- **Ejemplo para Meta:** {{1}}=Jampier · {{2}}=CICLO ESCOLAR — Canal: Canal 2 — Ingeniería Civil · {{3}}=https://matricula-publica.vercel.app/mi-matricula/abc123

## Variables de entorno en Railway (apiBotElite)
Una vez aprobadas, agrega (usando los nombres exactos que registraste en Meta):
```
WHATSAPP_TEMPLATE_CONFIRMACION=solicitud_recibida
WHATSAPP_TEMPLATE_APROBACION=matricula_aprobada
WHATSAPP_TEMPLATE_LANG=es_MX   # debe coincidir EXACTO con el idioma de la plantilla en Meta
MATRICULA_PUBLICA_URL=https://<tu-dominio-de-matricula-publica>
```
Sin estas variables el bot envía texto libre (solo entrega a números que ya
escribieron al bot en las últimas 24h).
