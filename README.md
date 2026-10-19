# Mi flujo de trabajo

App web de una sola página (HTML + JS, sin build) con cuatro solapas:

- **Tareas**: título, fecha y categoría; filtros por estado y categoría; vencidas y de hoy resaltadas.
- **Configuración**: tu `mi_configuracion/README.md` renderizado como Markdown, con botón *Copiar* en cada bloque de código. Se puede editar y guardar.
- **Links**: nombre, URL y categoría; click abre en pestaña nueva; búsqueda y filtro.
- **Notas**: editor Markdown con vista previa en vivo (Editar / Ambos / Vista) y autoguardado.

Además: **Exportar / Importar** (copia de seguridad en JSON), modo claro/oscuro automático y diseño adaptado a móvil.

## Modos de almacenamiento

| Modo | Cuándo | Dónde se guardan los datos |
|------|--------|----------------------------|
| **Local** | `config.js` con las claves vacías (por defecto) | `localStorage` de ese navegador |
| **Nube** | `config.js` con URL y anon key de Supabase | Tu proyecto Supabase, con login |

En modo Local los datos no viajan entre dispositivos: usá *Exportar* para hacer copias.

## Publicar en GitHub Pages

1. Creá un repositorio (por ejemplo `flujo-trabajo`) y subí todos estos archivos a la raíz.
2. *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
3. Abrí `https://<tu-usuario>.github.io/flujo-trabajo/`.

## Activar la nube (Supabase + login)

1. En Supabase, *SQL Editor*: pegá y ejecutá `supabase.sql`.
2. *Authentication → Users → Add user*: creá tu usuario (email + contraseña).
3. *Authentication → Providers → Email*: desactivá "Allow new users to sign up".
4. *Project Settings → API*: copiá **Project URL** y la clave **anon public** en `config.js`.
5. Subí `config.js` actualizado. La anon key es pública por diseño; lo que protege tus datos es la política RLS del SQL (cada fila solo es visible para su dueño).

## Archivos

- `index.html`, `style.css`, `app.js`: la app.
- `config.js`: claves de Supabase (opcional).
- `seed.js`: texto inicial de la solapa Configuración (copiado de tu README del zip).
- `supabase.sql`: tabla `flujo_items` + políticas RLS.

Las librerías `marked`, `DOMPurify` y `supabase-js` se cargan desde CDN con versión fija.
