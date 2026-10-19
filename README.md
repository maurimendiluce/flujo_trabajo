# Mi flujo de trabajo

App web de una sola página (HTML + JS, sin build) con cuatro solapas:

- **Tareas**: título, fecha y categoría (menú desplegable); filtros por estado y categoría; vencidas y de hoy resaltadas. Opcional: se envían a Google Tasks y se ven en Google Calendar.
- **Configuración**: tu `mi_configuracion/README.md` renderizado como Markdown (con LaTeX y botón *Copiar* en cada bloque de código). Se puede editar y guardar.
- **Links**: nombre, URL y categoría; click abre en pestaña nueva; búsqueda y filtro.
- **Notas**: editor Markdown con vista previa en vivo (Editar / Ambos / Vista), **LaTeX**, barra de formato y autoguardado.

Además: **Exportar / Importar** (copia de seguridad en JSON), modo claro/oscuro automático y diseño adaptado a móvil.

## Categorías con color

Las categorías se crean desde el menú desplegable ("＋ Nueva categoría…") o con el botón ⚙ al lado. Ahí mismo elegís el color de cada una, las renombrás o las borrás (las tareas y links quedan sin categoría). Son compartidas por Tareas y Links.

Si venías de la versión anterior, las categorías de texto se convierten solas en categorías con color la primera vez que abrís la app.

## LaTeX

Se escribe igual que en LaTeX, en Notas y en Configuración (usa KaTeX):

| Escribís | Resultado |
|----------|-----------|
| `$x^2 + y^2 = z^2$` | fórmula en línea |
| `$$\int_\Omega \nabla u\cdot\nabla v\,dx = \int_\Omega f v\,dx$$` | fórmula en bloque |
| `\(a_i\)` y `\[ ... \]` | equivalentes a las anteriores |
| `\begin{align} a &= b \\ c &= d \end{align}` | entornos `equation`, `align`, `gather`, `multline` |

Los precios como "$5 y $10" no se toman como fórmula, y nada dentro de `código` o bloques ``` se renderiza. Un `\$` escrito así queda como signo de pesos. La barra sobre el editor tiene botones para negrita, cursiva, código y fórmulas.

## Modos de almacenamiento

| Modo | Cuándo | Dónde se guardan los datos |
|------|--------|----------------------------|
| **Local** | `config.js` con las claves de Supabase vacías (por defecto) | `localStorage` de ese navegador |
| **Nube** | `config.js` con URL y anon key de Supabase | Tu proyecto Supabase, con login |

En modo Local los datos no viajan entre dispositivos: usá *Exportar* para hacer copias.

## Publicar en GitHub Pages

1. Creá un repositorio (por ejemplo `flujo-trabajo`) y subí todos estos archivos a la raíz.
2. *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
3. Abrí `https://<tu-usuario>.github.io/flujo-trabajo/`.

## Activar la nube (Supabase + login)

Podés usar un proyecto de Supabase que ya tengas: la app solo usa la tabla `flujo_items`.

1. En Supabase, *SQL Editor*: pegá y ejecutá `supabase.sql`.
   - **Si ya habías ejecutado la versión anterior**, ejecutá en cambio `supabase-update.sql` (agrega el tipo "category").
2. Usá el mismo usuario que ya tengas en ese proyecto (o creá uno en *Authentication → Users*).
3. *Project Settings → API*: copiá **Project URL** y la clave **anon public** en `config.js`.
4. Subí `config.js` actualizado. La anon key es pública por diseño; lo que protege tus datos es la política RLS del SQL (cada fila solo es visible para su dueño).

## Google Calendar (vía Google Tasks)

Las tareas se envían a **Google Tasks**, que Google Calendar muestra como "tareas" en el día de su fecha (también aparecen en la app Tasks del celular). Es una sincronización en un solo sentido: app → Google.

Qué se envía: título, fecha (si tiene), estado (hecha/pendiente) y la categoría en las notas. Al crear, editar, completar, reabrir o borrar una tarea en la app, se refleja en Google. Las tareas sin fecha van a Google Tasks pero no aparecen en el calendario.

### Configuración (una sola vez, ~10 minutos)

1. Entrá a <https://console.cloud.google.com> y creá un proyecto (por ejemplo "Flujo de trabajo").
2. *APIs y servicios → Biblioteca* → buscá **Google Tasks API** → **Habilitar**.
3. *APIs y servicios → Pantalla de consentimiento de OAuth*:
   - Tipo de usuario: **Externo**. Completá nombre de la app y tu email.
   - En **Usuarios de prueba**, agregá tu propia cuenta de Gmail. Dejá la app en modo "Prueba" (no hace falta publicarla).
4. *APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth*:
   - Tipo de aplicación: **Aplicación web**.
   - **Orígenes de JavaScript autorizados**: `https://<tu-usuario>.github.io` (solo el dominio, sin la ruta del repositorio ni barra final). Para probar en tu compu agregá también `http://localhost:8000`.
   - No hace falta URI de redirección.
5. Copiá el **ID de cliente** (termina en `.apps.googleusercontent.com`) en `config.js`:
   ```js
   GOOGLE_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
   ```
6. Subí `config.js` y abrí la app: aparece el botón **Conectar Google** arriba a la derecha.

### Uso

- Tocá **Conectar Google**, elegí tu cuenta y aceptá el permiso (Google avisará que la app no está verificada: es normal en modo "Prueba", tocá *Configuración avanzada → Continuar*).
- Al conectar se envían todas las tareas pendientes. Después se sincroniza cada cambio.
- El permiso dura 1 hora. Si vence o recargás la página, el botón vuelve a "Conectar Google" (un solo click). Lo que hayas hecho mientras estabas desconectado se envía al reconectar.
- **Sincronizar** reenvía manualmente todo el estado.

Limitaciones: los cambios hechos directamente en Google no vuelven a la app; si borrás una tarea mientras estás desconectado, queda en Google y hay que borrarla allí. En modo "Prueba", Google pide volver a dar el permiso cada 7 días.

## Archivos

- `index.html`, `style.css`, `app.js`: la app.
- `config.js`: claves de Supabase y de Google (opcionales).
- `seed.js`: texto inicial de la solapa Configuración (copiado de tu README del zip).
- `supabase.sql`: tabla `flujo_items` + políticas RLS (instalación nueva).
- `supabase-update.sql`: actualización para quien ya tenía la versión anterior.

Las librerías `marked`, `DOMPurify`, `KaTeX` y `supabase-js` se cargan desde CDN con versión fija; para Google se usa la librería oficial `accounts.google.com/gsi/client`.
