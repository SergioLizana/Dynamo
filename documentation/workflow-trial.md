# Ensayo: un workflow en lugar de `/run`

Probado el 2026-10-27 con Claude Code 2.1.311 en Windows 11 (Git Bash), desde `release/0.1.0` (`d4a1a26`). Motivo:
lanzar cada ticket con `claude -p` funciona, pero no se ve en la consola mientras corre. Se probó un workflow dinámico
(plan §6.3; investigación §3.6) como orquestador de la etapa 3a, en tres ensayos sobre ramas y tickets de prueba,
ya borrados.

## Qué se configuró

- `"worktree": { "baseRef": "head" }` en `.claude/settings.json`: las copias de los subagentes salen del checkout
  actual, no de `main` (`d4a1a26`).
- Workflows activados en `/config`. En el plan Pro vienen apagados y aconsejan menos de 5 agentes por ejecución.
- Excepción en `CLAUDE.md` a «sin scripts propios» para los guiones de workflow.

## Cómo era el guion

Un orquestador «tonto»: el guion solo decide qué toca y lanza agentes. El estado sale de GitHub y de lo que devuelven
los agentes.

1. **Frontier:** un agente lee en GitHub el estado, las etiquetas y los bloqueos nativos de los tickets.
2. **Build:** por cada ticket listo, un agente en su propia copia (`isolation: 'worktree'`). Crea
   `ticket/<n>-…`, mueve la tarjeta, hace el ticket, pasa la comprobación automática y hace commit. Nunca saca la
   base ni fusiona.
3. **Review:** nuestro subagente (`agentType: 'reviewer'`) revisa la rama del ticket contra la base, sin sacarla.
4. **Merge:** un agente en la carpeta principal, **de uno en uno** (cola en el guion): `git merge --no-ff`,
   comprobación otra vez (si falla, `git revert`), etiqueta, tarjeta y comentario. Si el ticket no pasó, etiqueta
   `bloqueado`.
5. El tope de 2 vueltas, la espera a los bloqueadores y el salto de los dependientes de un bloqueado van en el
   código del guion, no en una skill.

## Resultados

| Ensayo | Tickets | Modelo | Agentes | Tokens de subagentes | Llamadas | Duración | Resultado |
|---|---|---|---|---|---|---|---|
| 1 | #22 | el de la sesión | 3 | ~92.000 | 26 | 1 min 54 s | fusionado en 1 vuelta |
| 2 | #23-#26 (#24 ← #23, #26 ← #25) | Opus, `effort: low` | 17 | ~470.000 | 133 | 5 min 53 s | los 4 fusionados; #24 y #25 en 2 vueltas |
| 3 | #27 (imposible), #28 ← #27 | Haiku, `effort: high` | 6 | ~196.000 | 48 | 2 min 50 s | #27 bloqueado, #28 saltado |

Ninguna ejecución pidió un permiso ni hizo push. `main` y `release/0.1.0` no se tocaron.

## Comprobado

- **La copia sale de la base, con `.claude/`:** en los tres ensayos `startHead` coincidió con la punta de la base y
  `hasSkills: true`. En el ensayo 2, la segunda vuelta del #24 arrancó en `23fcbd3`, que ya traía la fusión del #25.
- **Nuestro `reviewer` dentro del workflow:** con `agentType: 'reviewer'` devolvió su formato exacto («VEREDICTO:
  PASA», casillas con evidencia, «Fuera del ticket: ninguno»). En el ensayo 2 detectó la errata puesta a propósito.
- **Dos a la vez:** #23 y #25 pasaron a *In Progress* a las 11:14:14 y 11:14:15.
- **Bloqueos respetados:** #24 empezó a las 11:16:10, tras *Done* del #23 (11:15:29); #26 a las 11:17:28, tras el
  #25 (11:16:41).
- **Segunda vuelta:** el historial del #24 dice `In Review -> In Progress -> Verify -> In Review -> Verify -> Done`.
- **Fusión en serie:** cuatro merges `--no-ff` seguidos en la carpeta principal, cada uno con su comprobación.
- **Bloqueo y salto:** #27 acabó con `bloqueado` y la tarjeta en *Verify*, donde se paró, y un comentario con el
  motivo literal. #28 recibió «saltado: depende de #27, que no llegó a la release» y siguió en *Todo* sin etiqueta.
- **Se ve en la consola:** `/workflows` muestra fases, agentes, sus llamadas, su resultado y los tokens de cada uno.

## Fallos del guion, para arreglar al escribirlo de verdad

1. **No limpia todo.** El agente de fusión solo quitaba la copia de la última vuelta. Quedaron copias de vueltas
   anteriores y unas 17 ramas (`ticket/…-prueba-*`, `worktree-wf_*`). Borrar ramas está en `ask`, así que dentro del
   workflow se lo preguntaría al humano.
2. **Historial sucio en la segunda vuelta.** Traer el trabajo de la vuelta 1 con `git merge` deja commits «Merge
   branch … into worktree-wf_…». Con `git cherry-pick <base>..<rama de la vuelta 1>` queda lineal, pero solo si la
   vuelta 1 hizo commit: con el rango vacío falla (`error: empty commit set passed`, ensayo 3).
3. **Una segunda vuelta que no sirve.** Cuando el Builder dice que el ticket se contradice y necesita al humano,
   repetir no arregla nada. Ese caso debería bloquear directamente.
4. **Afirmaciones sin comprobar.** El comentario del #27 decía que su copia seguía en disco; Claude Code la había
   borrado sola al acabar sin cambios. Con `effort: low`, un agente dio el commit de fusión como «HEAD of …» en vez
   del sha.
5. **Órdenes compuestas.** En una copia aislada, Claude Code rechaza órdenes encadenadas («too complex to verify that
   it stays inside the worktree»). Los agentes las partían y seguían, pero la función `move_card` de
   `documentation/github-board.md` no sirve ahí: hay que darles la forma de una sola orden con `--url`.
6. **El guion no ejecuta órdenes.** Leer el tablero, comprobar y fusionar lo hacen agentes que informan del código de
   salida. Las comprobaciones dejan de ser órdenes que nadie puede falsear: se fían de lo que diga el agente.

## Frente a `claude -p` (ensayo del #17)

- **Ventajas:** se ve en `/workflows`; el bucle y el tope están en código; el orquestador no gasta contexto; en sesión
  interactiva espera al límite de uso en vez de fallar (investigación §3.6).
- **Inconvenientes:** no da coste en USD, solo tokens; los permisos son los de la sesión, sin separar por agente; un
  permiso que haga falta se le pregunta al humano y la ejecución espera.

## Sin probar

- Un choque al fusionar (`git merge --abort` y bloqueado) y una comprobación que falle después de fusionar (revert).
- Un permiso pedido a mitad de ejecución.
- Pausa por límite de uso y reanudación tras cerrar la sesión.
- Tickets reales, más largos que crear un fichero de una línea.

## Recomendación

Sustituir `/run` por un workflow guardado en `.claude/workflows/`, con el diseño de arriba y los fallos 1-5
arreglados. `/implement` se queda para lanzar un ticket a mano en una sesión normal.
