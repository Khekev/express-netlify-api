# API REST de Telemetría con Express y Netlify Blobs

## 1. Descripción

API REST desarrollada con Express.js y desplegada como Netlify Function. Registra y consulta eventos de telemetría del funnel de conversión del proyecto final (Funnel y Demo Day), desde el escaneo del código QR hasta el envío del formulario de feedback.

Los eventos se almacenan de forma persistente con **Netlify Blobs**, en la tienda `funnel-metrics`. La API también incluye consulta de hora del servidor y envío de correos protegido con API Key.

## 2. Tecnologías utilizadas

- Node.js
- Express.js
- Netlify Functions y `serverless-http`
- Netlify Blobs (`@netlify/blobs`)
- Nodemailer
- dotenv
- HTML, CSS y JavaScript (frontend de prueba)
- Postman

## 3. Arquitectura del proyecto

```
express-netlify-api/
|-- netlify/
|   `-- functions/
|       `-- api.js          # Entrypoint Express + Netlify Blobs
|-- public/
|   `-- index.html          # Frontend de prueba de telemetría
|-- evidencias/             # Capturas de Postman y panel de Netlify
|-- .env.example            # Plantilla de variables de entorno
|-- .gitignore
|-- netlify.toml            # Build y reescritura de rutas
|-- package.json
|-- telemetria_netlify_blobs.postman_collection.json
`-- README.md
```

### Notas de implementación

- **Patrón Adapter:** `serverless-http` adapta la aplicación Express al formato de Netlify Functions. Un redirect en `netlify.toml` (`/api/*` → `/.netlify/functions/api/:splat`) mantiene las URLs públicas limpias.
- **Conexión con Blobs:** como la función usa el formato clásico (`handler(event, context)`), el handler llama a `connectLambda(event)` en cada ejecución para que el SDK de Blobs reciba su configuración del entorno. En Netlify no se necesita ningún token manual.
- **Consistencia:** el almacén se abre con `consistency: "strong"`. Si el entorno no la soporta (por ejemplo, el emulador local, que no entrega la URL necesaria), el código reintenta con consistencia eventual y deja un aviso en consola.

## 4. Endpoints

| Método | Endpoint | Función |
|---|---|---|
| GET | `/api/time` | Consulta la fecha y hora del servidor. |
| POST | `/api/send-email` | Envía correos (requiere cabecera `x-api-key`). |
| POST | `/api/metrics` | Registra un evento del funnel. |
| GET | `/api/metrics` | Consulta eventos y resumen agregado. |
| GET | `/api/metrics?step=mofu_landing` | Filtra por fase del funnel. |
| GET | `/api/metrics?source=qr_campus` | Filtra por fuente de tráfico. |
| GET | `/api/metrics/export?format=csv` | Exporta las métricas a CSV. |

### POST /api/metrics

Cuerpo de la petición (`Content-Type: application/json`):

```json
{
  "step": "tofu_attraction",
  "source": "qr_campus",
  "sessionId": "sess_8f3a1c9",
  "metadata": { "device": "mobile" }
}
```

- `step` y `source` son obligatorios; si faltan o están vacíos, responde `400 Bad Request`.
- Si no llega `sessionId`, se asigna `anon_guest`.
- Cada evento recibe una clave única `metric_<timestamp>_<aleatorio>` y un timestamp ISO.
- Se persiste con `store.setJSON()` y responde `201 Created` con el evento almacenado.

Fases recomendadas para `step`: `tofu_attraction`, `mofu_landing`, `bofu_interaction`, `bofu_cross_promo` y `feedback_submission`.

### GET /api/metrics

Responde `200 OK` con la estructura:

```json
{
  "status": "success",
  "data": {
    "summary": {
      "totalEvents": 48,
      "byStep": { "tofu_attraction": 20 },
      "bySource": { "qr_campus": 28 }
    },
    "recentEvents": []
  }
}
```

El resumen se calcula sobre todos los eventos que cumplan los filtros. La lista `recentEvents` está limitada a 50 elementos por defecto (parámetro opcional `limit`, máximo 200).

## 5. Retos técnicos implementados

- **Reto 1 (Filtrado dinámico):** `GET /api/metrics?step=...&source=...` filtra los eventos y recalcula el resumen con los datos filtrados.
- **Reto 2 (Sesión y UTM):** `public/index.html` genera un UUID en `sessionStorage` y envía `utm_source`, `utm_medium` y `utm_campaign` dentro de `metadata`.
- **Reto 3 (Exportación CSV):** `GET /api/metrics/export?format=csv` devuelve un CSV con encabezados `id,step,source,sessionId,timestamp`, con `Content-Type: text/csv` y `Content-Disposition: attachment; filename="metricas_funnel.csv"`.

## 6. Seguridad

- API Key (`x-api-key`) para el endpoint de envío de correos.
- Validación y normalización de los datos recibidos (tipos, longitud, campos vacíos).
- Límite de tamaño del cuerpo de la petición y de `metadata`.
- Protección contra CRLF Injection en los campos que viajan en cabeceras de correo.
- Escape de HTML en el contenido de los correos.
- Escape de CSV y neutralización de fórmulas en la exportación.
- Credenciales en variables de entorno; `.env` está excluido del repositorio y solo se sube `.env.example`.

## 7. Preguntas teóricas de reflexión arquitectónica

**1. Persistencia vs. estado efímero**

Una función serverless corre en contenedores que la plataforma crea y destruye bajo demanda, por lo que cualquier variable global en memoria se pierde cuando el contenedor se congela o se elimina. Además, varias instancias pueden atender peticiones al mismo tiempo, cada una con su propia memoria, así que ni siquiera hay un estado compartido entre ellas.

Netlify Blobs resuelve esto externalizando el estado: los datos viven en un almacenamiento distribuido y gestionado por la plataforma, independiente del ciclo de vida de las funciones. Cualquier instancia, presente o futura, lee y escribe en el mismo lugar.

Diferencias entre un almacén clave-valor/objeto y una base de datos relacional (SQL) para métricas de eventos:

- **Esquema:** el almacén guarda JSON sin esquema rígido, y un evento nuevo con campos distintos no requiere migraciones. SQL exige definir tablas y columnas.
- **Conexiones:** SQL en serverless puede agotar el pool de conexiones, porque cada instancia abre las suyas. Blobs se accede por HTTP, sin pool que administrar.
- **Operación y costo:** no hay servidor ni clúster que aprovisionar o mantener.
- **Consultas:** SQL permite filtrar, agrupar y unir con una sola consulta (`GROUP BY`, `JOIN`). En Blobs solo se consulta por clave o prefijo, y las agregaciones se hacen en código, lo que es una desventaja a gran escala.
- **Transacciones e integridad:** SQL ofrece transacciones y restricciones; un almacén de objetos no.

Para ingesta rápida de eventos independientes y semiestructurados, un almacén clave-valor es más simple. Para análisis complejos sobre grandes volúmenes, SQL o un almacén analítico sería mejor.

**2. Consistencia fuerte vs. consistencia eventual**

Con **consistencia fuerte**, después de que una escritura se confirma, cualquier lectura posterior devuelve el dato actualizado, sin importar qué nodo la atienda. Con **consistencia eventual**, las réplicas se sincronizan con un pequeño retraso: durante ese lapso una lectura puede devolver datos desactualizados, y solo después de un tiempo todas coinciden.

En el panel de métricas con consistencia eventual y mucho tráfico concurrente, un evento recién registrado podría no aparecer aún en `store.list()` o en `store.get()`. El contador total y el resumen por fase quedarían momentáneamente por debajo de la realidad, y dos consultas seguidas podrían mostrar cifras distintas. Los datos no se perderían: el panel solo mostraría un estado ligeramente atrasado. Se solicita `strong` para que el panel refleje lo último registrado, a cambio de algo más de latencia.

En este proyecto, el emulador local no soporta lecturas con consistencia fuerte, por lo que el código reintenta con consistencia eventual solo en ese caso. En desarrollo local da igual, porque hay un único proceso; en producción se busca usar `strong`.

**3. Garantía de envío en frontend (`keepalive` y `navigator.sendBeacon`)**

Cuando el usuario hace clic en un enlace que lo saca de la página, el navegador descarta la página actual y cancela las peticiones `fetch()` que sigan en curso. Si la métrica del clic todavía no terminó de enviarse, nunca llega al servidor, justo en el evento de conversión que más interesa.

- `fetch(..., { keepalive: true })` indica al navegador que la petición puede continuar aunque la página se cierre o se navegue a otra.
- `navigator.sendBeacon(url, datos)` es una API pensada para telemetría: el navegador pone el envío en cola y lo realiza en segundo plano, de forma asíncrona y sin bloquear la navegación. Solo envía POST y no permite leer la respuesta.

Ambas mantienen el envío vivo fuera del ciclo de vida de la página, por eso la métrica llega aunque el usuario ya esté en otro sitio. En este proyecto se usa `keepalive: true`, que además permite cabeceras como `Content-Type: application/json`.

**4. Particionamiento y escalabilidad de claves**

Con 100,000 eventos, `GET /api/metrics` ejecutaría `store.list()` sobre todos los registros y luego una lectura individual por cada blob con `Promise.all()`. Eso son 100,000 peticiones por cada consulta: la latencia crecería mucho, se consumiría memoria, se arriesgaría el tiempo máximo de ejecución de la función y se generaría un costo innecesario, todo para devolver al final unos pocos números.

Mitigaciones en producción:

- **Prefijos por fecha:** guardar claves como `2026-11-09/metric_...` para listar solo el día o la hora que interesa con `list({ prefix })`.
- **Paginación:** listar y leer por páginas en lugar de cargar todo.
- **Contadores agregados:** al registrar cada evento, incrementar contadores precalculados (por fase, por fuente y por día) en un blob aparte. Así, el resumen se obtiene leyendo un solo objeto. Con alta concurrencia hay que cuidar las condiciones de carrera al actualizarlos.
- **Límites y caché:** limitar el número de eventos devueltos (este proyecto ya limita `recentEvents`) y cachear el resumen unos segundos.
- **Almacén analítico:** si el volumen sigue creciendo, enviar los eventos a una base de datos o servicio de analítica pensado para agregaciones.

**5. Higiene de datos y prevención de spam**

Como el endpoint POST es público, cualquiera puede llamarlo. Los riesgos son:

- **Métricas falsas:** datos inventados o masivos que contaminan el análisis del funnel.
- **Denegación de servicio y costos:** millones de peticiones que saturan la función y llenan el almacenamiento.
- **Datos maliciosos:** valores enormes, tipos inesperados o contenido pensado para romper el CSV o inyectar código en el panel (por ejemplo, XSS o fórmulas de Excel).

Técnicas para reducirlos:

- **Validación de esquema** con Zod o Joi: tipos, longitudes máximas y lista permitida de valores para `step`. Este proyecto ya valida tipos y longitudes, y limita el tamaño del cuerpo y de `metadata`.
- **Rate limiting** por IP o por sesión, en la función o en un servicio perimetral.
- **CORS estricto**, para aceptar peticiones de navegador solo desde el dominio propio. No protege contra scripts fuera del navegador, por lo que no sustituye a las demás medidas.
- **Token de sesión firmado o CAPTCHA** en los puntos más sensibles, como el formulario de feedback.
- **Sanitización al mostrar y exportar:** escape de HTML y de CSV, como ya se hace aquí.
- **Monitoreo:** alertas ante picos anormales de eventos.

## 8. Instalación y ejecución local

```bash
npm install
```

Copia `.env.example` como `.env` y completa los valores que necesites. Solo `/api/send-email` los usa. Netlify Blobs funciona sin token en local gracias al emulador, así que **no** definas `NETLIFY_SITE_ID` ni `NETLIFY_AUTH_TOKEN`.

```bash
npm run dev
```

La aplicación queda disponible en `http://localhost:8888`.

## 9. Variables de entorno

| Variable | Uso |
|---|---|
| `API_SECRET_KEY` | Clave para proteger `POST /api/send-email`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Servidor de correo para `/api/send-email`. |
| `EMAIL_FROM` | Remitente de los correos (opcional). |

Netlify Blobs no requiere variables manuales: en producción el SDK obtiene las credenciales de la plataforma.

## 10. Despliegue en Netlify

1. Conectar el repositorio de GitHub a Netlify.
2. Netlify detecta `netlify.toml` y las funciones en `netlify/functions/`.
3. Configurar en **Site configuration → Environment variables** las variables de la sección anterior que se necesiten.
4. Verificar que la tienda `funnel-metrics` aparezca en la sección **Blobs** del panel.

## 11. Pruebas con Postman

La colección `telemetria_netlify_blobs.postman_collection.json` contiene:

- `POST /api/metrics` con un evento de atracción (`step: "tofu_attraction"`, `source: "qr_campus"`).
- `POST /api/metrics` con un evento de conversión (`step: "bofu_interaction"`).
- Dos peticiones de error (`400`): falta `source` y campos vacíos.
- `GET /api/metrics` para consultar el resumen y la lista de eventos.
- Filtros por paso y por fuente, exportación CSV, consulta de hora y envío de correo.

La variable `baseUrl` de la colección apunta a la URL pública de Netlify.

## 12. Evidencias

> Ajusta los nombres de archivo a los de tus capturas en la carpeta `evidencias/`.

**POST /api/metrics (201 Created)**

![POST 201](evidencias/post-metrics-201.png)

**GET /api/metrics (resumen y eventos)**

![GET metrics](evidencias/get-metrics.png)

**Panel de Netlify > Blobs > `funnel-metrics`**

![Netlify Blobs](evidencias/netlify-blobs.png)

## 13. Enlaces

- **GitHub:** https://github.com/Khekev/express-netlify-api
- **Sitio en Netlify:** https://express-netlify-api1.netlify.app/
- **Endpoint de métricas:** https://express-netlify-api1.netlify.app/api/metrics