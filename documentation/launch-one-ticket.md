# Lanzar /implement sin intervenir

`/implement` corre desatendido con `claude -p`: nadie responde a los avisos de permiso, así que lo que no está
permitido se deniega. Los permisos están en `.claude/settings.json` (lista blanca y lista negra; lo negado gana).
Lo que no está en ninguna lista lo decide el modo `auto`; con `--permission-prompts none`, lo que preguntaría se
deniega.

Un ticket por comando, desde la raíz del repositorio y con el árbol limpio (`12` es el número del ticket):

```bash
printf '/implement 12' | claude -p --max-budget-usd 5 --permission-mode auto --permission-prompts none
```

- El prompt va por la entrada estándar: así la `/` llega tal cual a `claude` y la skill se lanza como skill. Pasado
  como argumento, algunas consolas lo reescriben como una ruta.
- Para probar sobre otra base: `printf '/implement 12 release/0.0.0-prueba' | claude -p …`, con las mismas opciones.
- Tope de coste por ticket: 5 USD para empezar; se ajusta tras los 3 primeros tickets (plan §10.6).
- Varios tickets se lanzan de uno en uno, con un comando cada uno.

## Medición

A mano no se anotan turnos ni coste: el comando no pide la salida en JSON y la sesión no conoce su propio coste.
`/implement` deja en el ticket las vueltas. El coste se mide por lista: al acabar una, se anota `/cost` de la sesión
en el informe del PR.

## Dónde se probó

Probado el 2026-10-27 con Claude Code 2.1.311 en Windows 11 (Git Bash), con las mismas opciones:
`printf '/zz-no-existe hola' | claude -p --max-budget-usd 0.2 --permission-mode auto --permission-prompts none` →
«El comando `/zz-no-existe` no está instalado en esta sesión»: la `/` llega a `claude`. En Linux y macOS está sin
probar.
