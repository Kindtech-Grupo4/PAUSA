# PAUSA · Pausa Somática y Bio-Interactiva

Prototipo desarrollado para **KindTECH – Tech for Good Challenge 2026** (Eje: *Crisis de salud mental y fatiga digital*).

## Ejecución rápida

Requisitos: **Python 3.10+** (sin librerías externas).

```bash
python pausa.py
```

O en Windows haciendo doble clic en `iniciar_pausa.bat`.

- **App del usuario:** `http://localhost:8765/`
- **Vista institucional ($k$-anonimato $\ge 20$):** `http://localhost:8765/institucion`

## Características principales

1. **Bienvenida anónima y privacidad por diseño:** Sin cuentas ni correos. Bóveda local cifrada con `AES-GCM 256` (`PBKDF2` con PIN opcional) y borrado automático tras 90 días de inactividad.
2. **Check-in con IA ética de doble capa:** Sugerencia explicable de detonantes a partir de notas opcionales, filtro de privacidad y protocolo de derivación directa ante señales de crisis (Línea 113, Línea 100, SAMU 106 y Bienestar Universitario).
3. **Pausa somática bio-interactiva:** Detección de exhalación por planitud espectral en micrófono y energía de movimiento en cámara ($64\times 48\text{ px}$) procesados 100% en memoria volátil (0 bytes grabados o transmitidos), además de modo táctil/teclado.
4. **Modo Camaleón (`Esc` `Esc`):** Transforma instantáneamente la ventana en una calculadora científica funcional para proteger la privacidad en dispositivos compartidos (para salir: mantener presionado `=` durante 1 segundo).
5. **Mis patrones y autonomía:** Lectura semanal a partir de 7 registros sin rachas ni puntajes punitivos, promoviendo la autonomía del usuario.
6. **Indicadores agregados institucionales ($k \ge 20$):** Bloqueo matemático cuando hay menos de 20 personas distintas y supresión de celdas con menos de 5 aportes.
