# Ecosistema vivo

Simulación 2D de un ecosistema (plantas, herbívoros y carnívoros) hecha con HTML, CSS y JavaScript puro. Sin dependencias ni paso de compilación.

## Cómo desplegarlo en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `ecosistema`).
2. Sube todos los archivos de esta carpeta a la raíz del repositorio (incluido `.nojekyll`).
3. Ve a **Settings → Pages**.
4. En **Build and deployment**, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
5. En un minuto o dos estará en `https://TU-USUARIO.github.io/ecosistema/`.

Para probarlo en local basta con abrir `index.html` en el navegador.

## Controles

- **Superherbívoro:** botón «Controlar superherbívoro». Moverse con WASD, flechas o arrastrando; Espacio = embestida; F = disparar.
- **Panel de parámetros:** velocidad, apariciones, percepción, ángulo de visión, costes de energía, reproducción, día y noche y volumen.
- **Modo debug:** muestra radios de percepción, conos de visión, objetivos, estados y vida.

## Estructura

- `index.html`: maquetación.
- `style.css`: estilos.
- `main.js`: simulación (configuración, utilidades, rejilla espacial, entidades, mundo, sonido, renderizado e interfaz).

Todos los valores del ecosistema están en el objeto `CONFIG` al principio de `main.js`.
