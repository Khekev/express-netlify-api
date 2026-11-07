# REST API con Express y Netlify Functions


## 1. Descripción

API REST desarrollada con Express.js y desplegada en Netlify Functions. Permite consultar la hora del servidor y enviar correos electrónicos mediante Nodemailer.

## 2. Tecnologías

- Node.js
- Express.js
- Netlify Functions
- Nodemailer
- serverless-http
- Postman

## 3. Endpoints

| Método | Endpoint | Función |

| GET | `/api/time` | Consulta fecha y hora del servidor. |
| POST | `/api/send-email` | Envía correos electrónicos. |

**URL de producción:**  
https://express-netlify-api1.netlify.app/

## 4. Seguridad

- Autenticación mediante API Key (`x-api-key`).
- Validación de datos.
- Protección contra CRLF Injection.
- Variables de entorno para proteger credenciales.
- Escape de contenido HTML.

## 5. Preguntas teóricas

1. ¿Qué es Cold Start? 
Es el tiempo adicional que necesita una función serverless para iniciar cuando no existe una instancia activa.

2. ¿Por qué no usar variables globales para almacenar información permanente?
Porque las funciones serverless pueden reiniciarse y perder sus variables. Para información permanente se necesita almacenamiento externo.

3. ¿Qué hace serverless-http?
Adapta Express para que pueda funcionar dentro de una función serverless como Netlify Functions.

4. ¿Por qué utilizar archivos .env?  
Permiten guardar credenciales y configuraciones fuera del código, evitando publicar información sensible.

5. ¿Qué es un Open Relay?
Es un servidor que permite enviar correos sin autorización adecuada. Puede utilizarse para distribuir spam y abusar del servicio.

## 6. Evidencias

-evidencias en la carpeta 

## 7. Enlaces

- **GitHub:** https://github.com/Khekev/express-netlify-api
- **Netlify:** https://express-netlify-api1.netlify.app/

