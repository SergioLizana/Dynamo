# Lanzar una lista de tickets con el workflow

El workflow `run` (`.claude/workflows/run.js`) construye una lista de tickets sin intervenir: lee el
estado en GitHub, construye cada ticket listo en su propia copia, lo revisa con el `reviewer`, fusiona de uno en uno
en la rama de trabajo y bloquea o salta lo que toque. Los datos del proyecto los lee de `.claude/factory.md`. Es el
diseño de `documentation/workflow-trial.md`. Se lanza con `/run`.

## Antes de lanzar

- Workflows activados en `/config` (en el plan Pro vienen apagados).
- `"worktree": { "baseRef": "head" }` en `.claude/settings.json`: las copias salen del checkout actual.
- La carpeta principal, en la rama de trabajo y sin cambios en lo rastreado (las copias de `.claude/worktrees/` no
  cuentan): ahí se fusiona. Si no, el workflow se para en *Frontier* y dice por qué.

## Lanzar

En una sesión normal de Claude Code, abierta en la raíz del repositorio:

```text
/run 34 35
```

O, con otras palabras, «Lanza /run con los tickets 34 y 35». Claude le pasa los números como `args`. Sin
números, toma todos los issues abiertos sin la etiqueta de hecho ni la de bloqueado. Para otra base:
«Lanza /run con los tickets 34 y 35 y base `release/0.0.0-prueba`» (`args = { tickets, base }`).

La primera vez, Claude Code pide permiso para lanzar el workflow (en modo `auto`, solo la primera vez). Una orden que
necesite permiso a mitad de ejecución se le pregunta al humano, y ese agente espera.

## Seguirla

`/workflows` abre la vista de la ejecución: las fases *Frontier*, *Build*, *Review* y *Merge*, cada agente con sus
llamadas, su resultado y sus tokens. `p` pausa o reanuda, `x` para un agente o la ejecución entera. También se ve una
línea de progreso en el panel de tareas, debajo de la entrada.

Al acabar, el workflow devuelve por ticket: hecho (con el commit de fusión), bloqueado (con el motivo) o saltado.
También devuelve las copias quitadas, las que se quedan y las ramas que tiene que borrar el humano. El estado de
verdad está en GitHub: la etiqueta, la tarjeta y el comentario de cada ticket.

## Cómo decide

- **Modelos:** Haiku con `effort: high` en *Frontier*, *Build* y *Merge* (`run.js:17`); el `reviewer` con
  `agentType: 'reviewer'` y el modelo de su definición, Opus (`run.js:313`).
- **Tope de 2 vueltas:** `run.js:18` y `:295`; si se agotan, bloqueado (`:307` comprobación, `:317` revisor).
- **Bloqueadores, de GitHub:** un agente ejecuta `.../dependencies/blocked_by` y devuelve la salida literal; el
  guion la analiza (`run.js:150-156` y `:159-165`), para todos los tickets antes de arrancar ninguno (`:366`). Si no
  se puede leer, el ticket se salta (`:280`).
- **Espera a los bloqueadores:** cada ticket espera a los de la lista (`run.js:287`). Un bloqueador de fuera de
  la lista tiene que estar ya cerrado o hecho; si no, el ticket se salta (`:283`).
- **Salto de los dependientes de un bloqueado:** «saltado: depende de #n, que no llegó a la release» (`:290`), sin
  etiqueta y con la tarjeta donde estaba.
- **Un ticket parado siempre se ve atascado:** el guion da la etiqueta de bloqueado y el estado exactos, sacados de
  los datos de *Frontier*, y lo comprueba con `gh issue view` (`run.js:169-186`). *Merge* no marca nada: dice dónde
  se paró y el guion pone *In Review* o *Verify* (`:333` y `:347`); si *Merge* no devuelve nada, se bloquea igual
  (`:345`). Si tras dos intentos no queda marcado, el resultado dice `marked: false` y lo avisa (`:185`).
- **Lo que pide una casilla fuera del código:** lo publica *Build* durante su paso (`run.js:217`); *Merge*
  publica solo el informe final y no lo repite (`:336` y `:338`).

## Fallos del ensayo, arreglados

Los fallos 1-5 de `documentation/workflow-trial.md`:

1. **No limpia todo:** al acabar, un agente quita todas las copias de la ejecución, de todas las vueltas (salvo la de
   un ticket bloqueado sin commit, que guarda el único trabajo) y lista las ramas que quedan para que las borre el
   humano, porque borrar ramas pide permiso (`run.js:373` y `:379-382`).
2. **Historial sucio en la segunda vuelta:** la vuelta 2 trae la vuelta 1 con `git cherry-pick`, y solo si
   `git log <base>..<rama>` lista commits (`run.js:201` y `:205-206`).
3. **Una segunda vuelta que no sirve:** si *Build* dice que el ticket necesita al humano, se bloquea sin segunda
   vuelta (`run.js:301-302`).
4. **Afirmaciones sin comprobar:** todo hecho sale de una orden ejecutada en ese paso, nunca «HEAD of …»
   (`run.js:21` y `:29`), y un commit tiene que ser un sha (`:32-33`).
5. **Órdenes compuestas:** una orden por llamada y tarjetas movidas por la URL del issue, sin `move_card`
   (`run.js:20` y `:24`).

## Ejecución `wf_41e0b269-ab2`

Primera con tickets reales: 2026-10-27, tickets #35-#38. #35 se fusionó (`49829bd`). Dos fallos, ambos del fallo 6
del ensayo (el guion se fiaba de lo que decían sus agentes), arreglados en el #39:

- *Frontier* devolvió #38 con `"blockers": []`, pero en GitHub #38 está bloqueado por #37. #38 se construyó con #37
  saltado; solo lo paró el revisor.
- Tras un conflicto al fusionar, el agente *Merge* dijo que `.claude/factory.md` «ya no define» la etiqueta de
  bloqueado (falso: seguía ahí) y dejó #36 sin etiqueta y con la tarjeta en *In Review*: nada mostraba que estaba
  atascado.

## Sin probar

Siguen sin probar lo que el ensayo dejó pendiente (comprobación que falla tras fusionar, permiso a mitad de
ejecución, pausa por límite de uso), que *Frontier* reciba bien `args` desde `/run` y los cambios del #39 con tickets
reales (solo en seco, con agentes simulados).
