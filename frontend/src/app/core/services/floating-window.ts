import { Injectable, signal } from '@angular/core';

/** Tipos mínimos de la Document Picture-in-Picture API (todavía no están en lib.dom). */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/**
 * Ventana flotante "siempre encima" (como las burbujas de Messenger), con la
 * Document Picture-in-Picture API de Chrome/Edge.
 *
 * Truco clave: no se crea un segundo Angular. Se MUEVE el elemento del avatar a la
 * ventanita: Angular sigue teniendo la referencia, así que sus bindings, el audio
 * y el estado siguen funcionando igual. Al cerrarla, el elemento vuelve a su lugar.
 */
@Injectable({ providedIn: 'root' })
export class FloatingWindow {
  readonly isOpen = signal(false);
  readonly supported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

  private pip: Window | null = null;

  /** Debe llamarse desde un clic (el navegador lo exige). */
  async open(element: HTMLElement, onClose?: () => void): Promise<void> {
    if (!this.supported || this.pip) return;
    const home = element.parentElement;
    const next = element.nextSibling;

    const pip = await window.documentPictureInPicture!.requestWindow({ width: 280, height: 240 });
    this.pip = pip;
    copyStyles(document, pip.document);
    pip.document.title = 'Nimbo';
    const style = pip.document.createElement('style');
    style.textContent = `
      html, body { margin: 0; height: 100%; background: var(--bg); overflow: hidden; }
      body { display: grid; place-items: center; padding: 12px; box-sizing: border-box; }
      body > * { width: 100%; max-width: 100%; }`;
    pip.document.head.append(style);
    pip.document.body.append(element);
    this.isOpen.set(true);

    // pagehide: el usuario cerró la ventanita (o la cerramos nosotros).
    pip.addEventListener('pagehide', () => {
      home?.insertBefore(element, next);
      this.pip = null;
      this.isOpen.set(false);
      onClose?.();
    });
  }

  close(): void {
    this.pip?.close();
  }
}

/** Copia los estilos de la app (globales y de cada componente) a la ventanita. */
function copyStyles(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement('style');
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
      to.head.append(style);
    } catch {
      // Hoja de otro origen (p. ej. una fuente de Google): se enlaza en vez de copiarse.
      if (sheet.href) {
        const link = to.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        to.head.append(link);
      }
    }
  }
}
