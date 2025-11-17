const { contextBridge, ipcRenderer } = require("electron");

// Solo exponemos funciones específicas y bien definidas
contextBridge.exposeInMainWorld("warp", {
  // Carga inicial de comandos, apps y archivos base
  bootstrap: () => ipcRenderer.invoke("data:bootstrap"),

  // Abre un elemento (comando, archivo o app)
  openItem: (payload) => ipcRenderer.invoke("open:item", payload),
  
  // Ejecuta un comando
  executeCommand: (command) => ipcRenderer.invoke("command:execute", command),

  // Busca archivos en tiempo real usando Everything
  searchFiles: (query) => ipcRenderer.invoke("files:search", query),

  // Maneja el enfoque del input desde el proceso principal
  focusInput: (callback) => {
    const handler = (_, ...args) => callback(...args);
    ipcRenderer.on("focus-input", handler);
    // Opcional: devolver una función para limpiar el listener si se necesita
    return () => ipcRenderer.removeListener("focus-input", handler);
  },

  playerShow: () => ipcRenderer.invoke("player:show"),
  spotifyLaunch: () => ipcRenderer.invoke("spotify:launch"),
  mediaControl: (action) => ipcRenderer.invoke("media:control", action),

  // Ocultar la ventana
  hideWindow: () => ipcRenderer.invoke("window:hide"),

  onShow: (handler) => {
    ipcRenderer.on("launcher:show", handler);
  }
});