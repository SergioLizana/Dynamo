# Lanzar una lista de tickets con el workflow

El workflow `run` (`.claude/workflows/run.js`) construye una lista de tickets sin intervenir: lee el
estado en GitHub, construye cada ticket listo en su propia copia, lo revisa con el `reviewer`, fusiona de uno en uno
en la rama de trabajo y bloquea o salta lo que toque. Los datos del proyecto los lee de `.claude/factory.md`; las
columnas del tablero y las fases, de `.claude/factory.json` (ver «Las fases»). Es el diseño de
`documentation/workflow-trial.md`. Se lanza con `/run`.

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

`/workflows` abre la vista de la ejecución: *Frontier* y las fases de `.claude/factory.json` (hoy *Build*, *Verify*,
*Review* y *Merge*), cada agente con sus
llamadas, su resultado y sus tokens. `p` pausa o reanuda, `x` para un agente o la ejecución entera. También se ve una
línea de progreso en el panel de tareas, debajo de la entrada.

Al acabar, el workflow devuelve por ticket: hecho (con el commit de fusión), bloqueado (con el motivo) o saltado.
También devuelve las copias quitadas, las que se quedan y las ramas que tiene que borrar el humano. El estado de
verdad está en GitHub: la etiqueta, la tarjeta y el comentario de cada ticket.

## Las fases

`.claude/factory.json` dice las columnas *Todo*, *Needs Human* y *Done* (`columns`), el paso previo (`start`: nombre,
modelo y esfuerzo de *Frontier* y de los agentes pequeños del guion) y las fases, en orden (`phases`). Una fase = una
columna = un agente. Cada fase lleva:

- `name`: el nombre; elige su función en `PHASES` (`run.js:249`).
- `column`: la columna del tablero en la que pone la tarjeta. `moveCard`: `"start"` la pone al empezar la fase, `"end"`
  solo si la fase pasa (así *Merge* acaba en *Done* sin volver atrás).
- `model`, `effort`, `agentType`: los del agente; `null` deja el suyo (el `reviewer`, el de su definición).
- `onFail`: una fase anterior, a la que vuelve el ticket en otra vuelta, o la columna *Needs Human*, que lo para.

Hoy (`factory.json:5-8`): *Build* en Sonnet, *Verify* en Haiku, *Review* con el `reviewer` y *Merge* en Haiku. Una
tarjeta fusionada pasa por *Todo* → *In Progress* → *Verify* → *In Review* → *Done*.

Cambiar un modelo, un esfuerzo o el nombre de una columna es editar solo el JSON. **Añadir una fase:**

1. Una entrada en `phases` de `.claude/factory.json`, en su sitio del orden, con los siete campos.
2. Una función en `run.js` junto a las otras (`buildPhase`, `run.js:127`, es la plantilla) que recibe el ticket y su
   estado (`ctx`) y devuelve `prompt`, `step` (la palabra de «Parado en»), `schema`, `isolation` o `serial` si los
   necesita, y `read(resultado)` → `{ pass: true }` o `{ pass: false, failure }` (`run.js:120-124`).
3. Añadirla a `PHASES` con el mismo nombre (`run.js:249`). El bucle (`run.js:450-479`) no se toca.

Si falta la función, o el JSON falta, no se puede leer o no es válido, el workflow se para al empezar y dice por qué
(`run.js:288-295`, comprobación en `:254-276`).

## Cómo decide

- **Modelos y esfuerzos:** de `.claude/factory.json`, nunca escritos en `run.js` (`optsOf`, `run.js:279-285`); el
  `reviewer` con `agentType: 'reviewer'` y sin modelo, así que usa el de su definición, Opus (`factory.json:7`). Solo
  la lectura del propio JSON va sin modelo, porque aún no se conoce (`run.js:287-290`).
- ***Build* no comprueba:** cambia y hace commit (`run.js:149-151`). ***Verify*** ejecuta la comprobación en la copia
  de *Build* y sobre su commit, y el guion lee el resultado literal (`run.js:166-192`): si falla, el ticket va adonde
  dice su `onFail`, con la salida literal para *Build*.
- **Tope de 2 vueltas:** `run.js:15`; cada fallo que devuelve el ticket a una fase anterior cuenta una vuelta, sea de
  *Verify* o del revisor (`run.js:465-472`). Agotadas, bloqueado (`:474-478`).
- **El tablero lo mueve el guion:** cada fase pone la tarjeta en su columna, por la URL del issue, y lo comprueba con
  `gh issue view` (`run.js:351-365`, llamadas en `:453` y `:461`). Los agentes de las fases no mueven tarjetas
  (`run.js:21`).
- **Bloqueadores, de GitHub:** un agente ejecuta `.../dependencies/blocked_by` y devuelve la salida literal; el
  guion la analiza (`run.js:334-349`), para todos los tickets antes de arrancar ninguno (`:497`). Si no se puede
  leer, el ticket se salta (`:433`).
- **Espera a los bloqueadores:** cada ticket espera a los de la lista (`run.js:440`). Un bloqueador de fuera de
  la lista tiene que estar ya cerrado o hecho; si no, el ticket se salta (`:436`).
- **Salto de los dependientes de un bloqueado:** «saltado: depende de #n, que no llegó a la release» (`:443`), sin
  etiqueta y con la tarjeta donde estaba.
- **Un ticket parado siempre se ve atascado:** el guion lo pasa a la columna *Needs Human* del JSON y lo comprueba
  (`run.js:368-371`). Si *Merge* se para, ya ha publicado su informe y el guion solo mueve la tarjeta (`:474-477`); si
  una fase no devuelve nada, se bloquea igual (`:459`). Si tras dos intentos no queda movida, el resultado dice
  `marked: false` y lo avisa (`:363`).
- **Lo que pide una casilla fuera del código:** lo publica *Build* durante su paso (`run.js:147`); *Merge*
  publica solo el informe final y no lo repite (`:237`).

## Fallos del ensayo, arreglados

Los fallos 1-5 de `documentation/workflow-trial.md`:

1. **No limpia todo:** al acabar, un agente quita todas las copias de la ejecución, de todas las vueltas (salvo la de
   un ticket bloqueado sin commit, que guarda el único trabajo) y lista las ramas que quedan para que las borre el
   humano, porque borrar ramas pide permiso (`run.js:155` y `:504-515`).
2. **Historial sucio en la segunda vuelta:** la vuelta 2 trae la vuelta 1 con `git cherry-pick`, y solo si
   `git log <base>..<rama>` lista commits (`run.js:126` y `:131-132`).
3. **Una segunda vuelta que no sirve:** si *Build* dice que el ticket necesita al humano, se bloquea sin segunda
   vuelta (`run.js:157-158`).
4. **Afirmaciones sin comprobar:** todo hecho sale de una orden ejecutada en ese paso, nunca «HEAD of …»
   (`run.js:18` y `:22-24`), y un commit tiene que ser un sha (`:27-28`).
5. **Órdenes compuestas:** una orden por llamada y tarjetas movidas por la URL del issue, sin `move_card`
   (`run.js:17` y `:21`, `:351-358`).

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
