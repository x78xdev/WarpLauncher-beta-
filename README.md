<div align="center">

  <img src="https://via.placeholder.com/150?text=WarpLauncher" alt="Logo de WarpLauncher" width="150" height="150" />

  # WarpLauncher (Beta)
  
  **El lanzador de siguiente generación: rápido, ligero y realmente útil.**

  [![Estado](https://img.shields.io/badge/Estado-Beta-orange?style=for-the-badge)](https://github.com/x78xdev/WarpLauncher-beta-)
  [![Versión](https://img.shields.io/badge/Versión-0.1.0-green?style=for-the-badge)](https://github.com/x78xdev/WarpLauncher-beta-/releases)
  [![Plataforma](https://img.shields.io/badge/Plataforma-Windows%2010%2F11-blue?style=for-the-badge)]()

</div>

---

## 📋 Tabla de Contenidos

- [Descripción](#-descripción)
- [Características](#-características)
- [Capturas de Pantalla](#-capturas-de-pantalla)
- [Requisitos Previos](#-requisitos-previos)
- [Instalación](#-instalación)
- [Uso](#-uso)
- [Hoja de Ruta (Roadmap)](#-hoja-de-ruta-roadmap)
- [Contribuir](#-contribuir)
- [Autor](#-autor)
- [Licencia](#-licencia)

---

## 🚀 Descripción

**WarpLauncher** es un lanzador universal para Windows pensado para convertirse en tu “centro de control”: abrir aplicaciones, archivos, comandos, hacer cálculos rápidos y acceder a lo que más usas desde un único atajo de teclado.

La idea base:

> 🧩 Un launcher todo-en-uno que integre atajos, notificaciones, calendario, tareas, música, notas, etc.  
> 💡 Valor real: sustituir varias apps con una sola y mejorar el enfoque.

Actualmente WarpLauncher ya funciona como:

- Buscador unificado de **apps, archivos y comandos**.  
- Panel de inicio con **Favoritos, Recientes y Sugeridos inteligentes** (según lo que más usas).  
- **Calculadora integrada** directa en la barra de búsqueda.

> **Nota:** El proyecto está en desarrollo activo (fase **Beta**).  
> Algunas funciones están en constante cambio y la API interna puede modificarse.

---

## ✨ Características

### 🔍 Búsqueda unificada

- Encuentra **aplicaciones instaladas** (escaneo del Menú Inicio / accesos directos `.lnk`).
- Busca **archivos y carpetas** en el sistema (integración con indexadores externos, como Everything, si se configura).
- Ejecuta **comandos personalizados** (apagar, reiniciar, abrir rutas, URLs, scripts, etc.).

### 🎯 Filtros por tipo (prefijos)

Desde la misma barra puedes filtrar qué quieres ver:

- `app:chrome` → solo aplicaciones.  
- `file:tarea` → solo archivos/carpetas.  
- `cmd:apagar` → solo comandos.  
- `fav:` → solo favoritos.  
- `recent:` → solo recientes.  
- `2+2*5` o `150*1.16` → modo calculadora.

### 🧠 Home inteligente (Inicio)

Cuando abres WarpLauncher con el buscador vacío, se muestra un **inicio seccionado**:

- **Favoritos** → items que tú marcaste con estrella.  
- **Recientes** → lo último que abriste (apps, archivos, comandos).  
- **Sugeridos** → atajos ordenados según **cuántas veces los usas** (uso real).

Así, tu Home (“Sugeridos”) se adapta a ti con el tiempo.

### ⭐ Favoritos y Recientes persistentes

- Marca cualquier app/archivo/comando como **favorito** y aparecerá siempre arriba, con estrella `★`.
- Todo lo que ejecutes se guarda en **recientes** (hasta un límite configurable).
- La información se guarda localmente para que se conserve entre sesiones.

### 🗂️ Iconos por tipo de archivo

Reconoce el tipo de archivo y muestra un icono adecuado:

- 📁 `DIR` → carpetas.  
- 🗜️ `ZIP` → archivos comprimidos (`.zip`, `.7z`, `.rar`, `.tar`, `.gz`, `.bz2`).  
- 📕 `PDF` → documentos `.pdf`.  
- 🖼️ `IMG` → imágenes (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.tiff`, `.svg`, `.ico`, etc.).  
- 🎬 `VID` → videos (`.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`).  
- 🎵 `AUD` → audios (`.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.m4a`, `.wma`).  
- 📄 `FILE` → resto de archivos.

### ⌨️ Atajos de teclado

- **Global** (configurado en main):  
  - `Ctrl + Space` → mostrar/ocultar WarpLauncher.
- **Dentro del launcher:**
  - `↑ / ↓` → moverte entre resultados.  
  - `Enter` → ejecutar el item seleccionado.  
  - `Ctrl + D` → alternar favorito del item actual.  
  - `Ctrl + F` → ir a vista de favoritos (`fav:`).  
  - `Ctrl + R` → ir a vista de recientes (`recent:`).

### 🪄 Comportamiento inteligente de ventana

- WarpLauncher se **oculta automáticamente** al abrir una app o archivo.  
- Diseño centrado, minimalista y cómodo para teclado.

---

## 📸 Capturas de Pantalla

| Panel Principal | Configuración |
|:---:|:---:|
| ![Main UI](https://via.placeholder.com/400x200?text=Interfaz+Principal) | ![Settings](https://via.placeholder.com/400x200?text=Configuracion) |
| *Vista del dashboard principal* | *Panel de opciones avanzadas (en desarrollo)* |

---

## 🛠 Requisitos Previos

Para ejecutar WarpLauncher en modo desarrollo:

- **Sistema Operativo:**  
  - Windows 10 / 11 (recomendado, es donde está optimizado).
- **Git:**  
  - Para clonar el repositorio.
- **(Opcional) Indexador de archivos:**  
  - [Everything](https://www.voidtools.com/) u otro, si quieres búsquedas de archivos más rápidas.
- **Espacio en disco:**  
  - ~200 MB para dependencias y build.

Para el usuario final (cuando haya builds):

- Solo necesitará Windows 10/11 y el ejecutable de WarpLauncher.

---

## 📥 Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/x78xdev/WarpLauncher-beta-.git
cd WarpLauncher-beta-
