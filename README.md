# REST API con Express y Netlify Functions

## Descripción

API REST desarrollada con Node.js, Express y Netlify Functions.

## Endpoints

### GET /api/time

Devuelve la fecha y hora del servidor, timestamp,
zona horaria, fecha formateada y plataforma.

### POST /api/send-email

Envía un correo electrónico utilizando Nodemailer y SMTP.

## Seguridad

- API Key mediante el encabezado x-api-key.
- Validación de campos obligatorios.
- Validación de correo electrónico.
- Protección contra CRLF Injection.
- Variables de entorno para proteger credenciales.

## apps ocupadas

- Node.js
- Express
- Netlify Functions
- Nodemailer
- Postman