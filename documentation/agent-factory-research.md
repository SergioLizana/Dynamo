# Factorías de agentes: qué se usa de verdad (2025-2026)

Fecha de consulta de todas las fuentes: **2026-10-26**. Documento de lectura para decidir el diseño de
`agent-factory-plan.md`.

**Cómo leerlo:**

- Cada dato lleva su enlace. Cuando no pude comprobar algo en una fuente primaria, lo digo con **sin verificar**.
- Distingo tres tipos de afirmación: lo que dice la documentación oficial, lo que dice el fabricante sin pruebas
  (**marketing**) y lo que cuentan quienes lo usan (**usuarios**).
- Las estrellas de GitHub las leí con la API de GitHub el 2026-10-26. Miden interés, no calidad.
- Las herramientas cambian cada semana. Muchas piezas de Claude Code que cito estaban en «research preview»
  (vista previa) o en beta ese día.

---

## 1. Resumen en diez líneas

1. Lo que funciona en empresas es siempre el mismo patrón: **una tarea, un agente aislado, verificación automática
   y un PR que revisa una persona**. Lo usan Stripe (más de 1.300 PR fusionados por semana en febrero de 2026),
   Spotify (más de 1.500 PR) y Ramp (un 30 % de sus PR fusionados en enero de 2026).
2. En ninguna fuente seria se fusiona sin una persona. Todo acaba en un PR revisado.
3. La calidad la deciden los **verificadores** (tests, build, lint y, a veces, un modelo que juzga el diff), no el
   número de agentes. «El verificador tiene que ser casi perfecto, o Claude resolverá el problema equivocado»
   (Carlini, Anthropic).
4. Los bucles tienen un tope corto. Stripe da a cada agente **como máximo dos rondas de CI** y después devuelve el
   trabajo a la persona.
5. El cuello de botella se mueve del código a la **revisión**: los equipos con mucha IA fusionan un 98 % más de PR,
   pero tardan un 91 % más en revisarlos y los PR son un 154 % más grandes (Faros, julio de 2025).
6. Varios agentes a la vez multiplican el gasto casi en proporción: diez sesiones gastan la cuota unas diez veces
   más rápido, según la documentación de Claude Code.
7. **Claude Code ya trae casi todas las piezas de una factoría**: subagentes en su propia copia de trabajo, sesiones
   en segundo plano, `/batch`, workflows dinámicos, `/goal`, sesiones en la nube que abren PR y los arreglan solas,
   tareas programadas y **Projects**, un coordinador que lanza hilos en paralelo en la nube.
8. Lo que no trae de serie es la **lista de tickets con «bloqueado por»** y la **rama de integración con un
   fusionador**. Eso es justo lo que aportan las skills de Matt Pocock (`/to-tickets` e `/implement-spec`).
9. Los orquestadores de la comunidad nacen y mueren rápido (la empresa de vibe-kanban cerró en abril de 2026,
   Crystal quedó obsoleto en febrero, GSD está archivado). Los enjambres grandes (ruflo, Gas Town) son caros y no
   publican medidas serias.
10. Para tu caso: copia lo que falta (tickets con bloqueos), copia las prácticas probadas de Stripe y Spotify
    (verificar antes del PR, tope de vueltas, comprobar que el cambio no se sale del ticket) y **prueba las piezas
    nativas de Claude Code antes de escribir `/run` a mano**.

---

## 2. Qué es una «factoría de agentes»

Una factoría de agentes es un sistema que convierte peticiones en código revisable usando agentes de IA, con la
menor intervención humana posible por el camino. La persona decide qué se hace y acepta el resultado. Los agentes
hacen el trabajo intermedio.

### 2.1 El esquema común

```text
Petición → Especificación → Lista de tareas (con dependencias)        ← la persona aprueba
                                   ↓
                     Despacho: qué tareas están libres
                                   ↓
        Agente en su copia aislada → Verificadores → ¿pasa? → PR
                  ↑____________ no pasa (máx. N vueltas) ____|
                                   ↓
                     Revisión humana → Fusión                         ← la persona acepta
```

### 2.2 Vocabulario mínimo

| Término | Qué significa |
|---|---|
| Agente | Un modelo que planifica sus pasos y usa herramientas (leer, editar, ejecutar comandos). |
| Subagente | Un agente que lanza otro agente para una tarea concreta, con su propio contexto, y que devuelve un resumen. |
| Modo headless | Ejecutar el agente sin interfaz, desde un script (`claude -p "..."`). |
| Copia de trabajo (worktree) | Otra carpeta con su propia rama del mismo repositorio git. Permite que dos agentes editen a la vez sin pisarse. |
| Sandbox | Una caja aislada (contenedor, máquina virtual) donde el agente puede hacer de todo sin dañar tu equipo. |
| Frontera | Las tareas cuyos bloqueos ya están resueltos, es decir, las que se pueden empezar ya. |
| Rama de integración | Una rama donde se van juntando los resultados de varias tareas antes de abrir un único PR. |
| Verificador | Un comprobador automático: tests, compilación, lint, formateo. |
| Juez LLM | Un modelo que lee el diff y decide si cumple la petición. |
| Desatendido (AFK) | El agente trabaja sin que nadie mire ni apruebe cada paso. |

### 2.3 Los cinco patrones que se ven en la práctica

| Patrón | Quién coordina | Ejemplos | Dónde está la persona |
|---|---|---|---|
| 1. Multiplexor de sesiones | Tú | claude-squad, Conductor, vibe-kanban, agent view de Claude Code | Lanzas cada sesión y revisas cada una. **Sigues siendo el despachador.** |
| 2. Un agente en bucle | Un script simple | Ralph, `/goal`, el arnés de Anthropic para tareas largas | Escribes la especificación y revisas al final. |
| 3. Coordinador y trabajadores sobre una lista de tareas | Un agente coordinador | `implement-spec` de Pocock, CCPM, Gas Town, agent teams, Projects | Apruebas la lista y revisas el resultado. |
| 4. De issue a PR en la nube | El producto | Copilot coding agent, Codex cloud, Jules, Cursor, Devin, Kiro, claude-code-action | Asignas el issue y revisas el PR. |
| 5. Flujo fijo con pasos de agente | Código determinista | Minions de Stripe, Honk de Spotify, workflows dinámicos de Claude Code | Diseñas el flujo una vez y revisas los PR. |

Tu diseño es el **patrón 3**, con trabajadores que se parecen a los patrones 4 y 5.

---

## 3. Las piezas que trae Claude Code

Todo este apartado sale de la documentación oficial en `code.claude.com`, leída el 2026-10-26. Las versiones que se
citan son de la serie v2.1.x. Varias piezas están en vista previa y pueden cambiar.

### 3.1 Tabla resumen

| Pieza | Qué le da a una factoría | Estado | Límite clave |
|---|---|---|---|
| [Subagentes](https://code.claude.com/docs/en/sub-agents.md) | Trabajadores con contexto propio, opcionalmente en su copia de trabajo | Estable | 20 a la vez por sesión; anidan hasta 3 niveles |
| [Copias de trabajo](https://code.claude.com/docs/en/worktrees.md) | Aislar las ediciones de cada agente | Estable | Con `-p` no se limpian solas |
| [Agent view y sesiones en segundo plano](https://code.claude.com/docs/en/agent-view.md) | Lanzar sesiones completas que siguen sin terminal y abren PR en borrador | Vista previa | Local: se paran si apagas el equipo |
| [`/batch`](https://code.claude.com/docs/en/commands.md) | Partir un cambio grande en 5 a 30 trozos independientes, cada uno en su copia | Skill incluida | Los trozos deben ser independientes |
| [Workflows dinámicos](https://code.claude.com/docs/en/workflows.md) | Un guion en JavaScript que lanza y coordina muchos subagentes | Disponible en planes de pago | Sin preguntas a la persona a mitad de ejecución |
| [Agent teams](https://code.claude.com/docs/en/agent-teams.md) | Un líder con compañeros y una lista de tareas con dependencias | Experimental, apagado por defecto | No aísla en copias de trabajo |
| [Modo headless (`claude -p`)](https://code.claude.com/docs/en/headless.md) | Lanzar Claude desde scripts, con salida JSON y coste | Estable | Lo que pediría permiso se deniega |
| [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview.md) | El mismo bucle de Claude Code como librería de Python o TypeScript | Estable | Pensado para clave de API |
| [Hooks](https://code.claude.com/docs/en/hooks.md) | Puertas deterministas: ejecutar comandos antes o después de cada acción | Estable | Corren fuera del sandbox |
| [`/goal`](https://code.claude.com/docs/en/goal.md) | Seguir trabajando hasta cumplir una condición | Estable | El juez solo lee la conversación |
| [Skills](https://code.claude.com/docs/en/skills.md) y [plugins](https://code.claude.com/docs/en/plugins/overview.md) | Empaquetar instrucciones, agentes, hooks y workflows | Estable | No todos llegan a la nube |
| [Modos de permiso](https://code.claude.com/docs/en/permission-modes.md) y [sandbox](https://code.claude.com/docs/en/sandboxing.md) | Trabajar sin preguntas sin destrozar nada | Estable | El sandbox no existe en Windows nativo |
| [GitHub Actions](https://code.claude.com/docs/en/github-actions.md) | Implementar issues desde GitHub, sin tu PC | v1 | Gasta minutos de Actions |
| [Sesiones en la nube](https://code.claude.com/docs/en/claude-code-on-the-web.md) | Tareas en paralelo en máquinas de Anthropic que abren PR y los arreglan | Pro, Max, Team, Enterprise | Comparten el límite de uso |
| [Projects](https://code.claude.com/docs/en/claude-projects.md) | Un coordinador que lanza hilos en la nube en paralelo y te dice cuáles te necesitan | Beta pública en Pro y Max | No está en la CLI |
| [Tareas programadas](https://code.claude.com/docs/en/routines.md) | Lanzar una sesión en la nube por horario, por API o por evento de GitHub | Vista previa | 100 ejecuciones por hora por cuenta |
| [`/code-review`](https://code.claude.com/docs/en/commands.md) y [ultrareview](https://code.claude.com/docs/en/ultrareview.md) | Revisar el diff o un PR; `ultra` hace una revisión multiagente en la nube | Skill incluida | `ultra`: 3 gratis en Pro y Max |

### 3.2 Subagentes

Un subagente se define en `.claude/agents/<nombre>.md`. Su cabecera admite, entre otros, estos campos
([fuente](https://code.claude.com/docs/en/sub-agents.md)):

- `isolation: worktree`: el subagente trabaja en una copia de trabajo temporal. Por defecto sale de la rama
  principal del repositorio, **no** del punto donde estás. Si no cambia nada, la copia se borra sola.
- `background: true`: corre en segundo plano. Sin configurar nada, los subagentes que lanza la sesión principal
  ya empiezan en segundo plano.
- `model`, `effort` y `maxTurns`: modelo, esfuerzo y tope de turnos. Al llegar al tope, devuelve su trabajo marcado
  como parcial.

Límites que importan:

- Por defecto, con **20 subagentes** corriendo en una sesión, lanzar otro falla. Se cambia con
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`.
- Un subagente puede lanzar otros **hasta tres niveles** por debajo de la conversación principal.
- Si la sesión principal está en modo `auto`, `acceptEdits` o `bypassPermissions`, el subagente usa ese mismo modo
  e **ignora** el `permissionMode` que le pongas.
- Las preguntas de permiso de los subagentes en segundo plano aparecen en la sesión principal. Si nadie contesta,
  esperan.

### 3.3 Copias de trabajo (worktrees)

`claude --worktree <nombre>` crea una copia en `.claude/worktrees/<nombre>/`, en una rama `worktree-<nombre>`
([fuente](https://code.claude.com/docs/en/worktrees.md)). Detalles útiles:

- Una copia es una carpeta limpia: no tiene `.env` ni dependencias instaladas. El fichero `.worktreeinclude` copia
  ficheros ignorados por git, como `.env`.
- `worktree.baseRef` decide de dónde sale la copia: `"fresh"` (rama principal del remoto, por defecto) o `"head"`
  (tu punto actual). Para una rama de integración necesitas `"head"` o crear la copia tú con `git worktree add`.
- **Con `-p` no hay limpieza automática**: las copias se quedan en disco hasta que las quitas con
  `git worktree remove`.
- Los plugins instalados a nivel de proyecto también se cargan en las copias (desde v2.1.200). Esto coincide con lo
  que anotaste: los instalados en `settings.local.json` no llegan.
- Claude Code bloquea que un agente aislado edite o lance git contra la carpeta principal.
- **En Windows**, cuando apruebas un comando con «no volver a preguntar» dentro de una copia, la regla se queda en
  esa copia y se pierde al borrarla. En otros sistemas se guarda en la carpeta principal.

### 3.4 Agent view y sesiones en segundo plano

`claude --bg "tarea"` o `claude agents` lanza sesiones completas que sigue ejecutando un proceso supervisor, aunque
cierres la terminal ([fuente](https://code.claude.com/docs/en/agent-view.md)). Lo que hace por ti:

- Antes de editar, cada sesión lanzada así **se mueve a su propia copia de trabajo**.
- Al terminar con cambios, se le indica que haga commit, push y **abra un PR en borrador**. Nunca hace push a `main`
  ni `master`, ni push forzado, ni fusiona.
- `claude agents --json` da el estado de todas las sesiones a un script.
- Avisa cuando una sesión necesita algo, termina o falla.

Lo que no resuelve:

- Una sesión que choca con una pregunta de permiso **se queda en «Needs input»** hasta que alguien la abre y
  contesta.
- Corre en tu equipo. Sobrevive a la suspensión, pero **se para si apagas el equipo**.
- Diez sesiones gastan la cuota unas diez veces más rápido que una.

### 3.5 `/batch`

Es una skill incluida. Investiga el código, parte el cambio en **5 a 30 unidades independientes** y te enseña el
plan. Cuando lo apruebas, lanza un subagente en segundo plano por unidad, cada uno en su copia de trabajo. Cada
subagente implementa, pasa los tests y publica su cambio ([fuente](https://code.claude.com/docs/en/commands.md)).

Es casi tu `/run`, **pero sin dependencias**: está pensada para trozos que no se esperan entre sí.

### 3.6 Workflows dinámicos

Un workflow es un guion de JavaScript que Claude escribe y que un motor ejecuta en segundo plano
([fuente](https://code.claude.com/docs/en/workflows.md)). Usa `agent()`, `pipeline()` y `parallel()` para lanzar
subagentes. La diferencia con un subagente o una skill es **quién guarda el plan**: aquí lo guarda el guion, no la
conversación, así que el contexto del coordinador no se llena.

- Hasta **16 agentes a la vez** por defecto y **1.000 agentes** como máximo por ejecución.
- Avisa con «Large workflow» si pasa de 25 agentes o de 1,5 millones de tokens previstos.
- **No admite preguntas a la persona a mitad de ejecución.** Para una aprobación entre etapas, se hace un workflow
  por etapa.
- Se puede retomar dentro de la misma sesión. Si llega al límite de uso, espera y sigue solo, pero **solo en
  sesiones interactivas con suscripción**. En `claude -p`, en el SDK o en una sesión en segundo plano, el agente
  falla.
- Se guarda como comando en `.claude/workflows/` para repetirlo.

El equipo de Claude Code cuenta que los usa para migraciones: un subagente por arreglo en su copia de trabajo, otro
agente que lo revisa de forma adversaria, y luego la fusión
([blog, 2 de junio de 2026](https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/)). El
mismo artículo avisa: «la mayoría de las tareas de programación normales no necesitan un panel de 5 revisores».

### 3.7 Agent teams

Un líder crea una **lista de tareas compartida con dependencias**: una tarea bloqueada no se puede coger hasta que se
completan las suyas, y al completarse se desbloquean solas ([fuente](https://code.claude.com/docs/en/agent-teams.md)).
Es lo más parecido a tu «frontera» que trae Claude Code. Pero:

- Es **experimental y está apagado por defecto** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).
- **No aísla a los compañeros en copias de trabajo**: hay que repartir ficheros para que no se pisen.
- Recomiendan de 3 a 5 compañeros. Cuesta unas 7 veces más tokens que una sesión normal cuando los compañeros van
  en modo plan ([fuente](https://code.claude.com/docs/en/costs.md)).
- Limitaciones declaradas: no se retoman tras `/resume`, el estado de las tareas a veces se queda atrás y bloquea a
  las dependientes, y el líder puede dar el trabajo por terminado antes de tiempo.
- No funciona con `claude -p`.

### 3.8 Modo headless (`claude -p`) y Agent SDK

`claude -p "tarea"` ejecuta Claude sin interfaz ([fuente](https://code.claude.com/docs/en/headless.md)). Opciones
que importan para una factoría:

- `--permission-mode auto`: un clasificador aprueba o bloquea cada acción en tu lugar.
- `--permission-prompts none` (desde v2.1.259): lo que pediría permiso se deniega y se le dice a Claude que no lo
  reintente. Así nada se queda esperando.
- `--output-format json`: devuelve el resultado, el identificador de sesión y `total_cost_usd`, el coste estimado.
- `--max-turns` y `--max-budget-usd`: topes de turnos y de dinero.
- `--json-schema`: obliga a devolver un JSON con una forma concreta. Útil para que el revisor diga PASA o FALLA.
- `--resume <id>`: continúa una sesión concreta.
- `--bare` arranca más rápido y sin cargar hooks, skills ni `CLAUDE.md`, pero **no usa tu suscripción**: pide una
  clave de API.
- Ojo: sin `--bare`, `-p` ejecuta los hooks y servidores MCP del proyecto **sin preguntar** si confías en la carpeta.

El [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview.md) da el mismo bucle como librería de Python y
TypeScript, con hooks, subagentes, permisos, sesiones y coste. La documentación pide usar clave de API y dice que
terceros no pueden ofrecer el inicio de sesión de claude.ai en sus productos. Para una factoría personal, `claude -p`
es suficiente y más simple.

### 3.9 Hooks

Los hooks ejecutan comandos tuyos en momentos fijos ([fuente](https://code.claude.com/docs/en/hooks.md)). Son las
**puertas deterministas** de una factoría:

- `Stop`: cuando Claude termina un turno. Spotify lo usa para pasar todos los verificadores **antes de abrir el PR**;
  si alguno falla, no hay PR ([Spotify, parte 3](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
- `PreToolUse` y `PermissionRequest`: aprobar o denegar acciones sin preguntar a nadie.
- `TaskCompleted` y `TeammateIdle`: puertas de calidad en agent teams.
- `WorktreeCreate` y `WorktreeRemove`: crear las copias a tu manera.
- `Notification`: avisos cuando una sesión en segundo plano te necesita o termina.

### 3.10 `/goal`

Fija una condición de fin y Claude sigue trabajando hasta cumplirla ([fuente](https://code.claude.com/docs/en/goal.md)).
Después de cada turno, un modelo pequeño decide si se cumple, si es imposible o si falta. Funciona con `-p`.

Detalle importante: ese juez **no ejecuta nada**, solo lee lo que Claude ha mostrado en la conversación. La
condición tiene que poder demostrarse con la salida de Claude, por ejemplo «`npm test` termina con código 0». Para
acotarlo, se añade «o para tras 20 turnos» a la condición.

### 3.11 Skills y plugins

Una skill es un `SKILL.md` que se carga solo cuando hace falta. Un plugin empaqueta skills, agentes, hooks,
servidores MCP y workflows ([fuente](https://code.claude.com/docs/en/plugins/overview.md)).

Ojo con la nube: los hilos de **Projects no cargan las skills que están en `.claude/skills/` del repositorio**, ni
los plugins declarados en su `.claude/settings.json`. Hay que activarlas en la cuenta de claude.ai o añadir los
plugins en los ajustes del proyecto ([fuente](https://code.claude.com/docs/en/claude-projects.md)).

### 3.12 Permisos y aislamiento

| Modo | Qué hace sin preguntar | Para qué sirve |
|---|---|---|
| `default` | Solo leer | Revisarlo todo tú |
| `acceptEdits` | Leer, editar y comandos de ficheros comunes | Iterar con supervisión |
| `plan` | Leer | Explorar sin cambiar nada |
| `auto` | Todo, con un clasificador que revisa cada acción | Tareas largas |
| `dontAsk` | Solo lo permitido de antemano; lo demás se deniega | CI y scripts cerrados |
| `bypassPermissions` | Todo | **Solo** contenedores o máquinas virtuales sin internet |

Fuente: [modos de permiso](https://code.claude.com/docs/en/permission-modes.md). Sobre el modo `auto`:

- Bloquea por defecto, entre otras cosas, `curl | bash`, push forzado, `git reset --hard`, despliegues a producción
  y **fusionar un PR que ninguna persona ha aprobado**.
- Tras **3 bloqueos seguidos o 20 en total**, deja de decidir y vuelve a preguntar. En una sesión desatendida eso
  significa quedarse esperando.
- La documentación lo dice claro: «reduce las preguntas de permiso, pero no garantiza la seguridad».

Sobre el [sandbox](https://code.claude.com/docs/en/sandboxing.md):

- Encierra los comandos de shell: escribir solo en la carpeta de trabajo y salir a la red solo hacia dominios
  permitidos.
- Funciona en macOS, Linux y WSL2. **En Windows nativo no existe**: los comandos corren sin sandbox. Si no puede
  arrancar, por defecto sigue sin sandbox en silencio, salvo que pongas `failIfUnavailable: true`.

### 3.13 GitHub Actions (`claude-code-action`)

La acción [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action) (9,6 mil estrellas)
corre Claude Code en los runners de GitHub ([fuente](https://code.claude.com/docs/en/github-actions.md)):

- **Modo interactivo**: alguien escribe `@claude` en un issue o PR y Claude responde, implementa y sube commits.
- **Modo automático**: con un `prompt`, se ejecuta ante cualquier evento de GitHub, incluido un horario. El prompt
  puede ser una skill (`/nombre`) o la skill de un plugin.
- Autenticación con clave de API o con `CLAUDE_CODE_OAUTH_TOKEN`, un token de tu suscripción que se genera con
  `claude setup-token`.
- Se controla el gasto con `--max-turns`, tiempos máximos del job y la concurrencia de GitHub.
- Detalle práctico: los commits hechos con el `GITHUB_TOKEN` por defecto **no disparan otros workflows**, así que el
  CI no correría sobre ellos. Hay que usar la app de Claude o un token propio.

Es una forma de ejecutar «implementa este ticket» sin tu PC encendido. Gasta minutos de GitHub Actions además de
tokens.

### 3.14 Sesiones en la nube

Una sesión en la nube es Claude Code corriendo en una máquina virtual de Anthropic
([fuente](https://code.claude.com/docs/en/claude-code-on-the-web.md)):

- `claude --cloud "tarea"` crea una sesión que clona tu remoto de GitHub en tu rama actual. Hay que hacer push
  antes.
- Cada `--cloud` es una sesión independiente: se pueden lanzar varias en paralelo.
- Trabajan en ramas `claude/...` y pueden crear el PR.
- **Auto-fix**: Claude vigila el PR, y cuando falla el CI o alguien comenta, investiga y sube el arreglo si está
  claro. No reacciona a los conflictos de fusión, porque GitHub no avisa de ellos.
- Las credenciales de GitHub no entran en la máquina: un proxy las añade fuera.
- Comparten el límite de uso con todo lo demás de tu cuenta, sin coste aparte por la máquina.
- `claude --teleport` trae una sesión de la nube a tu terminal.

### 3.15 Projects

**Esta es la pieza que más se parece a lo que quieres.** Un proyecto es una conversación larga donde Claude hace de
coordinador y lanza un **hilo** (una sesión en la nube) por tarea ([fuente](https://code.claude.com/docs/en/claude-projects.md)):

- Los hilos corren en paralelo, en la nube, y **siguen aunque cierres el portátil**.
- Cada hilo trabaja en su rama y abre un PR; después lo vigila con auto-fix.
- El panel **Overview** agrupa los hilos por estado: listos para revisar, «Waiting on you», trabajando, y
  «Landing» para los PR aprobados o en cola de fusión.
- Las instrucciones y la memoria del proyecto llegan a todos los hilos.
- Los hilos corren en modo `auto`. Las reglas de permiso del repositorio **no** se aplican.
- Si un hilo llega al límite de uso, espera y continúa solo cuando se renueva.
- El coordinador ve lo que los hilos le reportan, no cada paso que dan.

Límites y avisos:

- Beta pública en **Pro y Max**, desplegándose poco a poco. No está en Team ni Enterprise, ni en la CLI. Hay que
  mirar si aparece en la barra lateral de claude.ai/code.
- Por defecto, cada hilo usa **Opus con esfuerzo alto**, lo que más gasta.
- No hay número fijo de hilos: Claude lanza los que crea necesarios. «Máximo dos hilos a la vez» es una preferencia
  que guarda en memoria, **no un tope duro**. El tope real son 200 hilos nuevos al día.
- La documentación recomienda empezar pidiendo que proponga los hilos y espere tu visto bueno, y quitar ese freno
  cuando veas que vuelven bien.
- **No encontré en la documentación** un grafo de dependencias entre tareas ni una rama de integración. Se le puede
  pedir por instrucciones, pero no sé si lo respeta (sin verificar).

### 3.16 Tareas programadas en la nube

Antes se llamaban «routines». Son una configuración guardada (prompt, repositorios y conectores) que se ejecuta sola
en la nube ([fuente](https://code.claude.com/docs/en/routines.md)):

- Tres disparadores: **horario**, **llamada a una API** y **eventos de GitHub** (PR, releases e issues: abierto,
  etiquetado, asignado…).
- Corren en modo `auto`, en ramas `claude/...`, y aparecen como tú en GitHub.
- Límites: 100 ejecuciones programadas por hora por cuenta, y 30 lanzamientos manuales o por API por hora y tarea.
- Están en vista previa y gastan tu suscripción.

---

## 4. Factorías y orquestadores de la comunidad

### 4.1 Tabla comparativa

Estrellas y fecha del último push leídas con la API de GitHub el 2026-10-26.

| Herramienta | Idea en una línea | Cómo se definen las tareas | Paralelismo | Dónde interviene la persona | Madurez |
|---|---|---|---|---|---|
| [Skills de Pocock](https://github.com/mattpocock/skills) | Pocas skills en Markdown: entrevista, especificación, tickets, implementación | Issues con «Blocked by» en GitHub, GitLab o ficheros | `/implement-spec`: un subagente por ticket libre, cada uno en su copia | Aprueba la lista de tickets y el PR final | 303 mil ★, activo |
| [Sandcastle](https://github.com/mattpocock/sandcastle) | Librería TypeScript para lanzar agentes en sandboxes | Un prompt; plantillas que leen issues de GitHub o Beads | Un sandbox (Docker, Podman, Vercel) por ejecución | Escribe el prompt y revisa ramas | 8,6 mil ★, activo |
| [Superpowers](https://github.com/obra/superpowers) | Metodología en skills: diseño, plan, subagentes, TDD y revisión | Plan de tareas de 2 a 5 minutos | Un subagente nuevo por tarea, con revisión tras cada una | Aprueba el diseño y elige cómo cerrar la rama | 305 mil ★, activo |
| [CCPM](https://github.com/automazeio/ccpm) | Gestión de proyecto con issues de GitHub y copias de trabajo | PRD, épica y tareas con `depends_on` | Varios agentes por issue, en la misma copia de la épica | Aprueba cada fase y la fusión | 8,4 mil ★, activo |
| [Gas Town](https://github.com/gastownhall/gastown) | Un «alcalde» coordina trabajadores y una cola de fusión | «Beads»: issues guardados en git | Muchos trabajadores; dice escalar a 20 o 30 agentes | Habla con el alcalde y atiende escaladas | 18,5 mil ★, activo |
| [ruflo (antes claude-flow)](https://github.com/ruvnet/ruflo) | Enjambres de agentes sobre Claude Code vía MCP y hooks | Prompts, workflows, «misiones» | «Topologías» de enjambre (marketing) | Poco documentado | 79,3 mil ★, activo |
| [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) | Método ágil con roles de agente | Briefs, especificaciones y arquitectura | No lo describe | Revisa cada paso | 54,6 mil ★; v6.12 estable, v7 en alfa |
| [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework) | Configuración: 30 comandos, 20 personas, 7 modos | Comandos con un tema | `/spawn` sin detalle | En cada comando | 23,9 mil ★, v4.3.0 |
| [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) | Bucle plan, trabajo, revisión y «lo aprendido» | Plan desde una entrevista | Revisión multiagente | Entrevista inicial y fusión | 25,7 mil ★, activo |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | Interfaz de terminal para varias sesiones | Un prompt por sesión | tmux y una copia de trabajo por sesión | Lanza, revisa y hace push de cada una | 8,7 mil ★; último push 2026-08-20 |
| [Conductor](https://www.conductor.build/docs/) | App de Mac para agentes en paralelo | Una tarea por espacio de trabajo | Una copia y rama por tarea | Revisa el diff, abre el PR y fusiona | Código cerrado; solo macOS |
| [Crystal → Nimbalyst](https://github.com/stravu/crystal) | Sesiones paralelas en copias de trabajo | Un prompt por sesión | Una copia por sesión | Revisa y compara | **Obsoleto desde febrero de 2026** |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Tablero kanban que lanza agentes | Tarjetas del tablero | Un espacio con rama por tarea | Planifica, revisa y fusiona | 28,5 mil ★; **la empresa cerró el 10 de abril de 2026** |
| [get-shit-done (GSD)](https://github.com/gsd-build/get-shit-done) | Meta-prompts y desarrollo guiado por especificaciones | Especificaciones | Sin verificar | Sin verificar | 64 mil ★; **archivado** |
| [Ralph](https://ghuntley.com/ralph/) | Un bucle de bash que repite el mismo prompt | `specs/` y un `fix_plan.md` | Uno solo, con subagentes dentro | Escribe las especificaciones y vigila | Técnica, no herramienta |
| [claude_code_agent_farm](https://github.com/Dicklesworthstone/claude_code_agent_farm) | Más de 20 agentes con ficheros de bloqueo | Barridos de arreglos | Muchos a la vez | Lanza y revisa | 922 ★ |

### 4.2 Fichas cortas

**Skills de Matt Pocock.** El repositorio tiene ya muchas más skills que las que leíste: `grill-with-docs`,
`to-spec`, `to-tickets`, `implement`, `implement-spec`, `code-review`, `pr`, `retro`, `wayfinder` y otras
([README](https://github.com/mattpocock/skills)). `/setup-matt-pocock-skills` pregunta dónde viven los tickets
(GitHub, GitLab, ficheros locales u otro) y qué etiquetas usar. `implement-spec` trata los tickets como un **grafo**
con una frontera, crea una rama de integración, lanza implementadores en segundo plano en su copia (cada uno pasa
`tdd` y trae lo último de la integración antes de terminar), usa un subagente fusionador, hace una revisión final y
limpia las copias ([SKILL.md](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md)).
**No describe qué hacer ante un conflicto de fusión ni ante un ticket que falla.** No encontré métricas públicas de
su uso.

**Sandcastle.** Librería de TypeScript (`@ai-hero/sandcastle`) para ejecutar agentes en sandboxes de Docker, Podman o
Vercel ([README](https://github.com/mattpocock/sandcastle)). Soporta Claude Code, Codex, Cursor, OpenCode, Copilot y
Pi. Tres estrategias de rama: `head` (escribe en tu carpeta), `merge-to-head` (rama temporal que se fusiona y se
borra) y `branch` (commits en una rama con nombre). Todo es local; el README no describe cómo abrir PR. Avisa de que
lanzar copias en paralelo con `head` o `merge-to-head` no es seguro: cada una necesita su rama.

**Superpowers.** De Jesse Vincent. Flujo: entrevista, diseño aprobado por partes, copia de trabajo, plan de tareas
muy pequeñas, un subagente por tarea con revisión tras cada una, TDD estricto y cierre de la rama
([README](https://github.com/obra/superpowers)). Dice que es habitual que el agente trabaje «un par de horas» sin
desviarse; es una afirmación del autor, sin medidas.

**CCPM.** PRD, épica y hasta 10 tareas por épica con `depends_on`, `parallel` y `conflicts_with`, sincronizadas como
issues y sub-issues de GitHub, y una copia de trabajo **por épica** ([README](https://github.com/automazeio/ccpm)).
Sus cifras («89 % menos tiempo perdido», «75 % menos errores») son **marketing**: no da método. Su propia prueba
compara tres escenarios elegidos por los autores.

**Gas Town.** De Steve Yegge. Un «Mayor» coordina; los «polecats» son trabajadores; el «Witness» detecta agentes
atascados; la «Refinery» es una cola de fusión que agrupa cambios, pasa verificaciones y, si falla un lote, lo
divide para encontrar el culpable ([README](https://github.com/gastownhall/gastown)). El estado vive en git, así que
un agente puede reiniciarse sin perder nada. Dice escalar «cómodamente a 20 o 30 agentes». Según fuentes
secundarias, el propio Yegge avisa de que está en alfa y de que no se use en serio, y es caro: hace falta más de una
suscripción Max ([heise](https://heise.de/-11178824), [Maggie Appleton](https://maggieappleton.com/gastown)). Esos
avisos no los leí en el texto original: sin verificar.

**ruflo (antes claude-flow).** Un servidor MCP con unas 314 herramientas, hooks y «enjambres» con topologías y
consenso ([README](https://github.com/ruvnet/ruflo)). Las cifras de agentes no cuadran entre sí (100 y 98), y la
precisión de enrutado del 89 % no tiene método. Lo trato como **marketing** hasta ver medidas independientes.

**BMAD.** Método ágil con experiencia de producto, arquitectura, UX, desarrollo y pruebas
([README](https://github.com/bmad-code-org/BMAD-METHOD)). Ajusta la ceremonia al tamaño del cambio. Un módulo
«BMad Loop» dice construir, verificar y hacer retrospectiva de una épica entera sin supervisión; no lo probé ni
encontré medidas.

**SuperClaude.** Una capa de configuración con comandos, personas y modos
([README](https://github.com/SuperClaude-Org/SuperClaude_Framework)). Sus cifras de rendimiento («2-3 veces más
rápido, 30-50 % menos tokens») no traen método. No es una factoría: no ejecuta tareas en paralelo de forma
documentada.

**Compound Engineering.** Plugin de Every: entrevista, plan, trabajo, simplificación, revisión y un paso que guarda
lo aprendido en `docs/solutions/` ([README](https://github.com/EveryInc/compound-engineering-plugin)). `/lfg` hace
todo el bucle solo: abre el PR y vigila el CI con un presupuesto de arreglos acotado. **No fusiona** salvo que se lo
permitas.

**claude-squad, Conductor, Crystal y vibe-kanban.** Son multiplexores: te ayudan a lanzar y mirar varias sesiones,
cada una en su copia de trabajo, pero **tú sigues lanzando y revisando cada una**. claude-squad necesita tmux
([README](https://github.com/smtg-ai/claude-squad)). Conductor es de Melty Labs y, según su documentación, solo
funciona en macOS ([fuente secundaria](https://www.conductor.build/docs/installation)). Crystal está obsoleto desde
febrero de 2026 ([README](https://github.com/stravu/crystal)). La empresa de vibe-kanban cerró el 10 de abril de 2026
porque casi todos sus usuarios eran gratuitos; el proyecto sigue como código abierto local
([anuncio](https://vibekanban.com/shutdown)). Además, agent view de Claude Code ya hace lo esencial de todos ellos.

**Ralph.** Técnica de Geoffrey Huntley, de julio de 2025: `while :; do cat PROMPT.md | claude-code ; done`
([post](https://ghuntley.com/ralph/)). Una tarea por vuelta, un plan que el agente reescribe y tests como
«contrapresión». El propio autor avisa de que te despertarás con el código roto, de que el modelo tiende a dejar
implementaciones a medias y a repetir trabajo hecho, y de que no lo usaría en un código ya existente. Thoughtworks la
puso en «Assess» (evaluar) en abril de 2026 y señala su alto coste en tokens
([Radar](https://www.thoughtworks.com/en-de/radar/techniques/ralph-loop)).

---

## 5. Desarrollo guiado por especificaciones (SDD)

### 5.1 Cómo pasa cada herramienta de la idea a las tareas

| Herramienta | De idea a tareas | Cómo se ejecutan las tareas | Qué dicen los usuarios |
|---|---|---|---|
| [GitHub Spec Kit](https://github.com/github/spec-kit) (142,9 mil ★) | `constitution` (principios), `specify`, `clarify`, `plan`, `tasks`, `analyze` | `implement` y `converge`, repetidos hasta que dice «Converged»; recomienda revisar cada paso | Demasiados ficheros Markdown repetitivos; excesivo para un cambio mediano |
| [Kiro](https://kiro.dev/docs/specs/) (AWS) | `requirements.md`, `design.md` y `tasks.md` | «Run all tasks» monta un grafo de dependencias y ejecuta por **oleadas**: las tareas independientes de una oleada van a la vez | Para un error pequeño generó 4 historias con 16 criterios |
| [Agente autónomo de Kiro](https://kiro.dev/blog/introducing-kiro-autonomous-agent/) | Una tarea por chat o una etiqueta `kiro` en un issue de GitHub | Un sandbox por tarea, **hasta 10 a la vez**, abre PR y aprende de los comentarios de revisión | Vista previa desde diciembre de 2025; sin datos de uso |
| [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) | Briefs, especificación y arquitectura, según el tamaño | Flujos guiados; un módulo para épicas desatendidas | Sin datos |
| [Pocock](https://github.com/mattpocock/skills) | Entrevista, `to-spec` y `to-tickets` (cortes verticales con «Blocked by») | `implement` o `implement-spec` | Sin datos públicos |
| [CCPM](https://github.com/automazeio/ccpm) | PRD, épica y tareas con dependencias | Issues de GitHub y agentes por issue | Sin datos independientes |
| [Agent OS](https://github.com/buildermethods/agent-os) (5,5 mil ★) | Estándares del código y especificaciones | Lo hace el agente que uses | Sin datos |
| [Planificador de Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) | Un agente convierte un prompt de 1 a 4 frases en una especificación de producto | Un generador por «sprint» y un evaluador | Experimento interno |

### 5.2 La crítica más útil

Birgitta Böckeler, de Thoughtworks, probó Kiro, Spec Kit y Tessl en octubre de 2025
([martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)). Sus conclusiones:

- Distingue tres niveles: **spec-first** (la especificación sirve para la tarea y luego se puede tirar),
  **spec-anchored** (se mantiene con la funcionalidad) y **spec-as-source** (solo se edita la especificación). El
  útil hoy es el primero.
- Los flujos no se adaptan al tamaño del problema. Revisar mucho Markdown puede ser más duro que revisar código.
- Los agentes no siguen todas las instrucciones: tener una especificación da una **falsa sensación de control**.
  Spec Kit le generó clases duplicadas aunque sus notas decían que ya existían.
- Advierte del riesgo de que estas herramientas empeoren justo lo que querían mejorar: más revisión y más
  alucinaciones.

**Lo que te sirve:** las «oleadas» de Kiro son tu «frontera». Y la lección de tamaño confirma tu `/discover`, que
decide si algo cabe en un ticket o necesita especificación.

---

## 6. Lo que usan las empresas

### 6.1 Productos comerciales «de issue a PR»

| Producto | Cómo recibe tareas | Dónde corre | En paralelo | Revisión y fusión | Límites conocidos |
|---|---|---|---|---|---|
| [Copilot coding agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) | Panel de agentes, conversación, issue o PR | Entorno efímero en la nube | Una tarea por sesión | Rama y PR; lo revisas tú | Un repositorio, una rama y **un PR por tarea**; máximo **59 minutos** por sesión |
| [Claude y Codex en GitHub (Agent HQ)](https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github/) | Asignar el issue a Claude, Codex, Copilot o a los tres | Infraestructura de GitHub; el agente de Claude usa el Agent SDK | Varios agentes sobre el mismo issue | PR | Vista previa desde 2026-02-04; Copilot Pro+ o Enterprise; 1 petición premium por sesión |
| [Codex cloud](https://learn.chatgpt.com/docs/cloud) | ChatGPT (web, móvil, escritorio) o terminal | Un espacio propio por tarea | Sí | Commit o PR cuando lo decides | No leí los límites por plan |
| [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent) | Escritorio, web, Slack, Linear o `@cursor` en GitHub | Una máquina virtual por agente | «Tantos como quieras» (dicho por Cursor) | PR con capturas y vídeos | No en los planes Free y Plus; pide un límite de gasto |
| [Devin](https://docs.devin.ai/) | Slack, Teams, Linear, Jira, web o API | Su nube | Sí, según la documentación | PR en borrador | La página que leí no detalla precios ni lotes: sin verificar |
| [Factory (Droids)](https://docs.factory.com/) | App, CLI y web | Su nube o local | «Missions» | Revisa diff y fusiona | La página no explica cómo funcionan: sin verificar |
| [Google Jules](https://jules.google/docs) | Repositorio, rama y prompt; **propone un plan que apruebas** | Máquina virtual | 3, 15 o 60 tareas a la vez según el plan | Tú decides | [15, 100 o 300 tareas al día](https://jules.google/docs/usage-limits) |
| [Agente autónomo de Kiro](https://kiro.dev/blog/introducing-kiro-autonomous-agent/) | Etiqueta `kiro` o `/kiro` en un issue | Sandbox por tarea | Hasta 10 | PR explicado | Vista previa con límites semanales |

Lo común: **un PR por tarea**, la persona revisa y nadie fusiona solo. Jules es el único que mete una aprobación del
plan antes de tocar código.

### 6.2 Casos internos con fuente

| Empresa | Agente | Cómo empieza una tarea | Aislamiento | Verificación | Revisión | Cifras |
|---|---|---|---|---|---|---|
| Stripe | [Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) (fork del agente goose de Block) | Etiqueta en un hilo de Slack, botones en herramientas internas (por ejemplo, «arregla este test inestable») | «Devboxes» precalentadas en ~10 s, sin producción ni internet; **sin copias de trabajo**, que a su escala no funcionaban | Lint local en menos de 5 s; CI selectivo sobre más de 3 millones de tests; **máximo 2 rondas de CI** | Todo lo revisa una persona; los agentes escriben todo el código | Más de 1.000 PR por semana (9-feb-2026); [más de 1.300](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) (19-feb-2026) |
| Spotify | [Honk](https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1), sobre su sistema Fleet Management; según fuentes secundarias, acabaron usando Claude Code ([InfoQ](https://infoq.com/news/2026/03/spotify-honk-rewrite)) | Un prompt por migración; peticiones puntuales por Slack o GitHub | Contenedor con pocos permisos | Verificadores que se activan solos (por ejemplo, Maven si hay `pom.xml`) y un **juez LLM**; un hook `Stop` impide abrir el PR si algo falla | Revisión humana | Más de 1.500 PR fusionados (6-nov-2025); 60-90 % de ahorro de tiempo en migraciones, según los equipos |
| Ramp | Inspect ([InfoQ](https://infoq.com/news/2026/01/ramp-coding-agent-platform/), que enlaza [el post de Ramp](https://builders.ramp.com/post/why-we-built-our-background-agent)) | Bot de Slack, web y extensión de Chrome | Máquinas virtuales en Modal | El agente usa las mismas herramientas que un ingeniero: tests, bases de datos, Sentry, Datadog | Personas, que pueden mirar y guiar en vivo | ~30 % de los PR fusionados (enero de 2026) |
| Anthropic | [Compilador de C](https://www.anthropic.com/engineering/building-c-compiler) (Carlini) | Un bucle de bash reinicia cada sesión; los agentes eligen la siguiente tarea «más obvia» | Un contenedor Docker por agente; bloqueo de tareas con ficheros en git | Suites de tests de compiladores y GCC como «oráculo» | Investigación, sin PR | 16 agentes, ~2.000 sesiones, ~20.000 $ y 100.000 líneas en dos semanas |

Más datos internos de Anthropic:

- **Tareas largas** ([nov-2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)):
  un agente inicial prepara el entorno, un fichero de progreso y una lista de más de 200 funcionalidades en JSON,
  todas marcadas como fallidas. Después, cada sesión hace **una sola funcionalidad**, la prueba como un usuario y
  deja el código listo para fusionar. Eligieron JSON porque el modelo reescribe menos un JSON que un Markdown.
- **Planificador, generador y evaluador**
  ([mar-2026](https://www.anthropic.com/engineering/harness-design-long-running-apps)): el mismo juego hecho por un
  agente solo costó 9 $ en 20 minutos y salió roto; con el arnés completo, 200 $ en 6 horas, y funcionaba. Lección:
  un evaluador separado es mucho más fácil de hacer exigente que un agente que se juzga a sí mismo. Y cada pieza del
  arnés es una suposición sobre lo que el modelo no sabe hacer: hay que revisarlas con cada modelo nuevo y quitar
  las que sobran.

Datos que solo encontré en fuentes secundarias (**sin verificar**):

- Stripe: unos 7.000 PR de Minions en una semana de agosto de 2026, según el índice de Port que cita un podcast
  ([Port](https://software-factories.port.io/stripe)).
- Ramp: hasta un 75 % de los PR, según un podcast citado por terceros
  ([fourweekmba](https://fourweekmba.com/ai-ramp-inspect-agent-coding-verification-bottleneck/)).
- Coinbase: un agente interno que hace el 5 % de los PR fusionados
  ([resumen de terceros](https://rywalker.com/research/coinbase-forge)).
- Boris Cherny, creador de Claude Code: 5 sesiones en la terminal y de 5 a 10 en la web a la vez, según resúmenes de
  un hilo suyo ([Slashdot](https://developers.slashdot.org/story/26/01/06/2239243/creator-of-claude-code-reveals-his-workflow)).

### 6.3 Lo que repiten todas las empresas

1. **El agente hace una sola cosa: cambiar el código.** El push, el PR y Slack los hace la infraestructura de
   alrededor (Spotify).
2. **El aislamiento permite dar todos los permisos.** Como un error se queda dentro de la devbox, el agente corre sin
   preguntas (Stripe).
3. **Pasos fijos mezclados con pasos de agente.** Lint y push son código; «implementa» y «arregla el CI» son agente.
   Stripe lo llama «blueprints».
4. **Respuesta rápida antes que CI lento.** Lint local en segundos antes de subir nada.
5. **Tope de vueltas.** Tras dos rondas de CI, el trabajo vuelve a la persona.
6. **Infraestructura para personas, reutilizada.** Las mismas máquinas, el mismo CI y las mismas reglas que usan los
   ingenieros. «Lo que es bueno para las personas es bueno para los agentes» (Stripe).
7. **Siempre revisión humana del PR.**

---

## 7. Lecciones y fallos habituales

### 7.1 La revisión se convierte en el cuello de botella

- Simon Willison, octubre de 2025: «solo puedo centrarme en revisar y fusionar un cambio importante a la vez». Por
  eso solo lanza en paralelo tareas que le cuestan poco revisar: investigación, mantenimiento pequeño o trabajo que
  él mismo especificó al detalle. «El código que nace de tu propia especificación cuesta mucho menos de revisar»
  ([blog](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
- Faros, sobre más de 10.000 desarrolladores (julio de 2025): en los equipos con mucha IA, 21 % más tareas, 98 % más
  PR fusionados, **91 % más tiempo de revisión**, **PR un 154 % más grandes** y 9 % más errores por desarrollador. No
  encontraron mejora a nivel de empresa ([informe](https://www.faros.ai/blog/ai-software-engineering)). Faros vende
  analítica y el estudio es de correlación.
- Maggie Appleton, sobre Gas Town: el límite pasa a ser decidir qué construir y cómo, y avanzar tan rápido que nunca
  te paras a pensar ([nota](https://maggieappleton.com/gastown)).

### 7.2 El tamaño del PR importa

- Estudios sobre cientos de miles de PR hechos por agentes (el conjunto AIDev): los cambios más grandes y los push
  forzados se asocian con menos fusiones ([arXiv 2602.19441](https://arxiv.org/html/2602.19441v1)); los PR de
  documentación, CI y build se aceptan más, y los de rendimiento y corrección de errores, menos
  ([arXiv 2601.15195](https://arxiv.org/html/2601.15195v1)); el 67,9 % de los PR rechazados no tienen comentario del
  revisor: simplemente se abandonan ([arXiv 2602.04226](https://arxiv.org/abs/2602.04226)).
- Tu documento dice que Pocock reconoce que aún no sabe mantener pequeños los PR. No encontré esa frase en una fuente
  que pudiera leer: sin verificar por mí.

### 7.3 Sin buen verificador, el agente resuelve el problema equivocado

- Carlini: «el verificador tiene que ser casi perfecto, o Claude resolverá el problema equivocado». Y: «es fácil ver
  los tests en verde y suponer que el trabajo está hecho, cuando rara vez es así»
  ([post](https://www.anthropic.com/engineering/building-c-compiler)).
- Diseñó los tests **para un modelo**: salida corta, errores en ficheros con la palabra `ERROR` para buscarlos y una
  opción `--fast` que ejecuta una muestra aleatoria, porque el agente no tiene buena noción del tiempo.
- Spotify esconde al agente el ruido del build: sus verificadores devuelven solo el mensaje de error resumido
  ([parte 3](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
- Anthropic: los agentes rinden mucho mejor cuando prueban como un usuario, con un navegador, que con tests unitarios
  solos ([post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

### 7.4 Los fallos típicos de un agente desatendido

| Fallo | Quién lo cuenta |
|---|---|
| Se sale de lo pedido: refactoriza de más o desactiva tests inestables. Es lo que más veta su juez | [Spotify](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) |
| Deja implementaciones a medias o de relleno | [Huntley](https://ghuntley.com/ralph/), [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| Da el trabajo por terminado al ver progreso parcial | [Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| Marca funcionalidades como hechas sin probarlas de punta a punta | Anthropic (misma fuente) |
| Se juzga a sí mismo con demasiada indulgencia | [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| Busca mal y concluye que algo no existe, y lo implementa dos veces | [Huntley](https://ghuntley.com/ralph/) |
| Se mata a sí mismo con un comando (`pkill -9 bash`) | [Carlini](https://www.anthropic.com/engineering/building-c-compiler) |
| Se queda parado esperando un permiso | [Documentación de agent view](https://code.claude.com/docs/en/agent-view.md) |

Spotify ordena las consecuencias de menos a más grave: (1) no sale PR, (2) el PR falla el CI y (3) **el PR pasa el
CI pero hace algo incorrecto**, lo peor porque destruye la confianza. Su juez LLM veta **una de cada cuatro**
sesiones, y en la mitad de los casos el agente consigue corregirse. Aún no tienen evaluaciones del propio juez.

### 7.5 Coste y límites de uso

| Dato | Fuente |
|---|---|
| Un agente gasta ~4 veces más tokens que un chat; un sistema multiagente, ~15 veces | [Anthropic, junio de 2025](https://www.anthropic.com/engineering/multi-agent-research-system) |
| Agent teams: ~7 veces más tokens que una sesión normal con compañeros en modo plan | [Documentación de costes](https://code.claude.com/docs/en/costs.md) |
| Diez sesiones en segundo plano gastan la cuota ~10 veces más rápido | [Agent view](https://code.claude.com/docs/en/agent-view.md) |
| Media en empresas: ~13 $ por desarrollador y día activo; el 90 % gasta menos de 30 $ | [Documentación de costes](https://code.claude.com/docs/en/costs.md) |
| El arnés completo de Anthropic costó más de 20 veces lo que un agente solo | [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| Gas Town: miles de dólares al mes, según quienes lo probaron | [Maggie Appleton](https://maggieappleton.com/gastown), [heise](https://heise.de/-11178824) |
| Projects usa tus límites más rápido que una sesión; en Pro, «espera llegar antes al límite» | [Projects](https://code.claude.com/docs/en/claude-projects.md) |

Un buen detalle: en Projects, retomar un hilo que lleva más de una hora parado vuelve a leer toda su conversación,
porque la caché ha caducado. A veces sale más barato abrir un hilo nuevo.

### 7.6 Paralelo trae choques

- Cognition (los de Devin), junio de 2025: «no construyas multiagentes». Cada acción lleva decisiones implícitas, y
  dos agentes con decisiones distintas producen piezas que no encajan
  ([post](https://cognition.com/blog/dont-build-multi-agents)).
- Anthropic: la programación tiene menos tareas de verdad paralelizables que la investigación
  ([post](https://www.anthropic.com/engineering/multi-agent-research-system)).
- Carlini: los conflictos de fusión eran frecuentes y Claude los resolvía, pero con el kernel de Linux **los 16
  agentes chocaban con el mismo error**, lo arreglaban y se pisaban unos a otros. Lo resolvió partiendo el problema
  con un oráculo.
- Agent teams no aísla en copias de trabajo; la documentación pide repartir los ficheros a mano.
- Auto-fix de Claude no reacciona a los conflictos con la rama base, porque GitHub no lo notifica.

### 7.7 Permisos y sandbox

- Stripe da todos los permisos **porque** la devbox está aislada de producción y de internet.
- Willison solo usa el modo sin preguntas en local cuando sabe que no puede entrar contenido malicioso; para lo
  arriesgado prefiere la nube.
- En Claude Code, `bypassPermissions` solo en contenedores o máquinas virtuales sin internet; `auto` reduce preguntas
  pero no garantiza seguridad; y el sandbox **no existe en Windows nativo**.

### 7.8 El contexto del coordinador

Todas las soluciones serias sacan el estado de la conversación del coordinador:

- Los workflows dinámicos guardan el plan y los resultados en variables del guion, no en el contexto de Claude.
- `implement-spec` pide una comunicación «escasa» con los subagentes, usando punteros a la especificación y los
  tickets en vez de copiar contenido.
- El coordinador de Projects solo ve lo que los hilos le reportan.
- Gas Town, Ralph y el arnés de Anthropic guardan el estado en git y en ficheros.

Tu diseño ya va por ahí: `/run` no lee diffs enteros y el estado vive en los tickets.

### 7.9 Cuántos agentes en paralelo usa la gente

| Quién | Cuántos | Fuente |
|---|---|---|
| Simon Willison | Varios, sin número fijo; limitado por lo que puede revisar | [blog](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/) |
| Boris Cherny | 5 locales y 5-10 en la web | Secundaria, sin verificar |
| Documentación de agent teams | Empezar con 3 a 5 | [docs](https://code.claude.com/docs/en/agent-teams.md) |
| Documentación de Projects | Empezar con «unos pocos a la vez» y propuestos | [docs](https://code.claude.com/docs/en/claude-projects.md) |
| Jules (límite del producto) | 3, 15 o 60 según el plan | [docs](https://jules.google/docs/usage-limits) |
| Kiro autónomo (límite del producto) | 10 | [blog](https://kiro.dev/blog/introducing-kiro-autonomous-agent/) |
| Carlini | 16, en un experimento de 20.000 $ | [post](https://www.anthropic.com/engineering/building-c-compiler) |
| Gas Town | 20-30 (afirmación del propio proyecto) | [README](https://github.com/gastownhall/gastown) |

Tu N = 2 para empezar está dentro de lo prudente.

### 7.10 Qué miden

| Métrica | Quién |
|---|---|
| PR fusionados por semana | Stripe |
| Porcentaje de los PR fusionados que hace el agente | Ramp |
| PR fusionados y tiempo ahorrado por migración | Spotify |
| Porcentaje de sesiones que veta el juez y cuántas se corrigen | Spotify |
| Rondas de CI por ejecución, con tope | Stripe |
| Coste y duración por ejecución | Anthropic |
| Tiempo de revisión y tamaño del PR | Faros |
| Tasa de aceptación de PR | Estudios AIDev |

### 7.11 La percepción engaña

En un ensayo de METR de 2025, desarrolladores con experiencia esperaban ir un 24 % más rápido con IA, midieron un
19 % más lentos y, después, seguían creyendo que habían ido un 20 % más rápido
([TechCrunch](https://techcrunch.com/2025/07/11/ai-coding-tools-may-not-speed-up-every-developer-study-shows)). El
propio METR dice que ese resultado puede no reflejar las herramientas actuales, y su estudio de 2026 dio una señal
poco fiable ([resumen](https://conffab.com/?p=10163); no leí el texto original de METR). La lección no es «la IA
frena», sino **medir en vez de fiarse de la sensación**, que es tu regla 4.

### 7.12 Las herramientas cambian demasiado deprisa

En menos de un año: vibe-kanban perdió su empresa, Crystal se cambió de nombre y producto, GSD se archivó,
claude-flow pasó a llamarse ruflo y varias piezas de Claude Code siguen en vista previa con cambios casi semanales.
Depender de un orquestador de terceros es arriesgado. Depender de las piezas del propio Claude Code también cambia,
pero esas las mantiene quien hace el motor.

---

## 8. Qué significa esto para mi diseño

### 8.1 La respuesta corta, sin rodeos

**Gran parte de lo que quieres ya existe dentro de Claude Code.** No hace falta construir la maquinaria; hace falta
poner encima lo que falta.

- **Si tu cuenta tiene Projects**, ya tienes un coordinador que lanza hilos en paralelo en la nube, con rama y PR por
  hilo, arreglo automático del CI, un panel que te dice qué te necesita, y trabajo que sigue con el PC apagado. Es tu
  `/run` hecho producto. Lo que **no** encontré en su documentación: el grafo de tickets con «bloqueado por», la rama
  de integración y tu bucle constructor-revisor como garantía. Además, está en beta, es de un solo usuario, no carga
  las skills del repositorio y por defecto usa Opus con esfuerzo alto.
- **En local**, `claude --bg` por ticket, o subagentes con `isolation: worktree`, ya te dan «N trabajadores en su
  copia que abren PR en borrador». `/batch` hace casi lo mismo, pero sin dependencias. Necesitan el PC encendido.
- **`implement-spec` de Pocock ya es tu `/run`** escrito como una sola skill sobre esas piezas. Al leerlo, le faltan
  dos cosas que tu diseño sí tiene: qué hacer ante un conflicto y qué hacer con un ticket que no pasa.

Así que tu aportación real es pequeña: **tickets con bloqueos, una puerta de verificación, un tope de vueltas y un
informe de lo bloqueado**. Eso encaja con tu regla de no añadir nada sin un problema real.

### 8.2 Qué copiar

| Qué | De quién | Por qué | Coste |
|---|---|---|---|
| Tickets en cortes verticales, con «Blocked by», y la lista aprobada una sola vez | Pocock | Es lo único que no trae Claude Code de forma estable | Bajo: texto de skills |
| Calcular la frontera por oleadas | Kiro | Es exactamente tu «frontera» | Bajo |
| Verificadores deterministas antes de abrir el PR, con un hook `Stop` | Spotify | Evita PR que fallan el CI | Bajo: un hook |
| Tope de 2 vueltas y luego «bloqueado» con motivo | Stripe | Más vueltas dan cada vez menos | Bajo |
| Un juez que compara el diff con el ticket (¿se ha salido?) | Spotify | Es el fallo más común de un agente desatendido | Medio: una llamada más por ticket |
| Revisor separado del constructor, con contexto limpio | Anthropic, Pocock | El constructor se juzga con indulgencia | Ya lo tienes |
| Estado fuera de la conversación: tickets y git | Anthropic, Gas Town, Ralph | El coordinador no se llena y se puede retomar | Ya lo tienes |
| Un ticket por sesión, con contexto limpio | Anthropic, Pocock | Menos deriva | Ya lo tienes |
| El agente solo cambia código; el push y el PR los hace `/run` | Spotify | Agente más predecible | Bajo |
| Empezar por tareas de bajo riesgo y fáciles de revisar | Willison, Projects | Ganar confianza antes de soltar más | Ninguno |

### 8.3 Qué evitar

| Qué | Por qué |
|---|---|
| Enjambres y decenas de agentes (ruflo, Gas Town) | Caros, poco medidos, y la revisión sigue siendo tuya |
| Un panel de varios revisores en cada vuelta | El propio equipo de Claude Code dice que la mayoría de tareas no lo necesita; en Cadenza fue la tarea más cara (60,5 M de lecturas de caché) |
| Ceremonia de especificación pesada para cosas pequeñas | Böckeler: 16 criterios para un error pequeño |
| Depender de un orquestador de terceros | vibe-kanban, Crystal y GSD ya no están |
| Una interfaz propia | Ya lo descartas; vibe-kanban muestra lo difícil que es mantenerla |
| `bypassPermissions` fuera de un contenedor | Sin protección ante instrucciones maliciosas |
| Agent teams para implementar | Experimental, sin copias de trabajo y con estados que se atascan |
| Fusionar a `main` sin persona | Nadie lo hace en las fuentes; el modo `auto` incluso lo bloquea por defecto |
| Resolver conflictos a ciegas | Carlini vio a 16 agentes pisarse; tu regla de «marcar bloqueado» es la correcta |

### 8.4 Qué está probado y qué no

| Idea | Evidencia | Veredicto |
|---|---|---|
| Una tarea aislada que acaba en PR, con verificación y revisión humana | Stripe, Spotify, Ramp, todos los productos comerciales | **Probado a escala** |
| Bucle desatendido largo con tests muy buenos | Carlini, Anthropic, Ralph en proyectos nuevos | Probado en investigación y proyectos nuevos; caro |
| Revisor separado del constructor | Experimentos de Anthropic | Probado en sus experimentos |
| Juez LLM del alcance | Spotify | Probado en un caso, sin evaluaciones del juez |
| N agentes en paralelo con rama de integración y fusionador automático | `implement-spec`, Gas Town; sin métricas públicas | **No probado** (no encontré datos) |
| Revisores por enfoque (seguridad, UX, UI, código) | No encontré evidencia de que mejoren el código; Anthropic avisa del gasto | **No probado** |
| Decidir por riesgo si hace falta persona, o ir a `main` sin persona | Nadie lo hace en las fuentes | **No probado** |
| 20-30 agentes a la vez | Gas Town, anecdótico | No probado y caro |

### 8.5 Una tensión de tu diseño: un PR grande al final

Tu diseño junta todos los tickets en una rama de integración y abre **un PR**. Mitiga el problema con tickets
pequeños y un commit por ticket. Pero la evidencia dice que los PR grandes se revisan peor y se fusionan menos
(Faros, estudios AIDev), y las empresas hacen **un PR por tarea**. Hay tres opciones:

| Opción | Ventaja | Inconveniente |
|---|---|---|
| A. Rama de integración y un PR final con un commit por ticket (tu diseño, Pocock) | Las dependencias se resuelven solas; revisas una vez | El PR final crece con la lista |
| B. Un PR por ticket contra `main` (Stripe, Spotify, Copilot, Projects por defecto) | PR pequeños | Los tickets bloqueados esperan a que tú fusiones: **vuelves a ser el cuello de botella a mitad del camino** |
| C. Un PR por ticket contra la rama de integración, fusionado solo cuando pasa el revisor, y un PR final a `main` | Unidades pequeñas que puedes leer una a una en el historial, y nadie te espera | Más ruido en GitHub |

**Mi sugerencia** (es opinión, no dato): quédate con A o C, pero **limita el tamaño de cada lista**, por ejemplo
de 5 a 8 tickets, para que el PR final siga siendo legible. CCPM limita a 10 tareas por épica. Si el PR final te
cuesta leerlo, pasa a C.

### 8.6 Ojo con Windows

Varias piezas no funcionan igual en Windows nativo:

- El sandbox de Claude Code no existe en Windows nativo.
- claude-squad necesita tmux, Conductor solo funciona en Mac y los paneles divididos de agent teams no funcionan en
  Windows Terminal.
- Las aprobaciones de «no volver a preguntar» dentro de una copia de trabajo se pierden al borrarla.

Para trabajar sin preguntas, tus opciones son: (1) modo `auto` con una lista de comandos permitidos y
`--permission-prompts none`; (2) WSL2 o un contenedor, donde sí hay sandbox; o (3) **la nube**, que resuelve a la
vez el aislamiento y el «PC encendido». Esta última es la más sencilla si tu cuenta la tiene.

### 8.7 ¿Cambia el orden de las etapas?

El orden se mantiene, con tres ajustes:

| Etapa | Cambio propuesto | Por qué |
|---|---|---|
| 0. Cliente | **Añadir:** comprobar en tu cuenta si tienes Projects, sesiones en la nube y agent view. Es una hora | Responde tu pregunta abierta 5 antes de diseñar `/run` |
| 1. Definir tareas | Sin cambios. Valora instalar las skills de Pocock tal cual y adaptarlas, en vez de reescribirlas | Ya tienen la configuración del gestor de tickets que quieres |
| 2. La unidad | **Añadir** la puerta de verificación (hook `Stop`), el tope de 2 vueltas y **medir desde el primer ticket** (`--output-format json` da el coste) | Medir antes de cambiar; la etapa 4 se reparte entre la 2 y la 3 |
| 3. La línea de montaje | **Antes de escribir `/run`, probar lo nativo** con N = 2: (a) Projects con la instrucción «un hilo por ticket de la frontera; no empieces los bloqueados»; (b) `claude --bg` por ticket; (c) `implement-spec` de Pocock sin tocar. Escribir solo lo que falte | Puede que `/run` acabe siendo muy pequeño o innecesario |
| 4. Medir | Se integra en la 2 y la 3 | |
| 5. Mejorar según datos | Sin cambios | |

### 8.8 Tus preguntas abiertas, con lo que ahora se sabe

| Pregunta | Lo que dice la investigación |
|---|---|
| 2. ¿Un PR por lista o por ticket? | Las empresas hacen uno por ticket; Pocock, uno por lista. Ver 8.5 |
| 4. ¿Cuántos a la vez? | Empezar con 2 está dentro de lo que se recomienda; el límite real es tu revisión y tu cuota |
| 5. ¿Local o nube? | La nube resuelve el «PC encendido» y el aislamiento; Projects está en beta en Pro y Max. Hay que mirar la cuenta |
| 6. ¿Qué permisos? | Modo `auto` con lista blanca y `--permission-prompts none`, o contenedor, o nube. `bypassPermissions` solo en contenedor |

---

## 9. Fuentes

Todas consultadas el **2026-10-26**. Entre paréntesis, la fecha de publicación cuando la conozco.

### Documentación oficial de Claude Code

- Visión general: https://code.claude.com/docs/en/overview
- Ejecutar agentes en paralelo: https://code.claude.com/docs/en/agents.md
- Subagentes: https://code.claude.com/docs/en/sub-agents.md
- Copias de trabajo: https://code.claude.com/docs/en/worktrees.md
- Agent view: https://code.claude.com/docs/en/agent-view.md
- Agent teams: https://code.claude.com/docs/en/agent-teams.md
- Workflows dinámicos: https://code.claude.com/docs/en/workflows.md
- Modo headless: https://code.claude.com/docs/en/headless.md
- Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview.md
- Hooks: https://code.claude.com/docs/en/hooks.md
- `/goal`: https://code.claude.com/docs/en/goal.md
- Comandos (`/batch`, `/code-review`, `/autofix-pr`): https://code.claude.com/docs/en/commands.md
- Skills: https://code.claude.com/docs/en/skills.md
- Plugins: https://code.claude.com/docs/en/plugins/overview.md
- Modos de permiso: https://code.claude.com/docs/en/permission-modes.md
- Sandbox: https://code.claude.com/docs/en/sandboxing.md
- GitHub Actions: https://code.claude.com/docs/en/github-actions.md
- Acción de GitHub: https://github.com/anthropics/claude-code-action
- Sesiones en la nube: https://code.claude.com/docs/en/claude-code-on-the-web.md
- Projects: https://code.claude.com/docs/en/claude-projects.md
- Tareas programadas: https://code.claude.com/docs/en/routines.md
- Costes: https://code.claude.com/docs/en/costs.md
- Ultrareview: https://code.claude.com/docs/en/ultrareview.md

### Anthropic (blog e ingeniería)

- Workflows dinámicos en el equipo de Claude Code (2026-06-02): https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/
- Arneses para agentes de larga duración (2025-11-26): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Diseño de arneses para aplicaciones largas (2026-03-24): https://www.anthropic.com/engineering/harness-design-long-running-apps
- Compilador de C con Claudes en paralelo (2026-02-05): https://www.anthropic.com/engineering/building-c-compiler
- Sistema de investigación multiagente (2025-06-13): https://www.anthropic.com/engineering/multi-agent-research-system

### Comunidad

- Skills de Matt Pocock: https://github.com/mattpocock/skills
- `implement-spec`: https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md
- Sandcastle: https://github.com/mattpocock/sandcastle
- Superpowers: https://github.com/obra/superpowers
- CCPM: https://github.com/automazeio/ccpm
- Gas Town: https://github.com/gastownhall/gastown
- Beads: https://github.com/gastownhall/beads
- ruflo: https://github.com/ruvnet/ruflo
- BMAD: https://github.com/bmad-code-org/BMAD-METHOD
- SuperClaude: https://github.com/SuperClaude-Org/SuperClaude_Framework
- Compound Engineering: https://github.com/EveryInc/compound-engineering-plugin
- claude-squad: https://github.com/smtg-ai/claude-squad
- Conductor: https://www.conductor.build/docs/
- Crystal: https://github.com/stravu/crystal
- vibe-kanban: https://github.com/BloopAI/vibe-kanban
- Cierre de vibe-kanban (2026-04-10): https://vibekanban.com/shutdown
- GSD: https://github.com/gsd-build/get-shit-done
- claude_code_agent_farm: https://github.com/Dicklesworthstone/claude_code_agent_farm
- Agent OS: https://github.com/buildermethods/agent-os
- Ralph (2025-07-14): https://ghuntley.com/ralph/
- Thoughtworks Radar sobre Ralph (2026-04-15): https://www.thoughtworks.com/en-de/radar/techniques/ralph-loop
- Maggie Appleton sobre Gas Town: https://maggieappleton.com/gastown
- heise sobre Gas Town: https://heise.de/-11178824

### Desarrollo guiado por especificaciones

- Spec Kit: https://github.com/github/spec-kit
- Kiro, especificaciones: https://kiro.dev/docs/specs/
- Agente autónomo de Kiro (2025-12-02): https://kiro.dev/blog/introducing-kiro-autonomous-agent/
- Böckeler sobre Kiro, Spec Kit y Tessl (2025-10-15): https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html

### Productos comerciales

- Copilot coding agent: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- Claude y Codex en GitHub (2026-02-04): https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github/
- Agentes de terceros en GitHub: https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents
- Codex cloud: https://learn.chatgpt.com/docs/cloud
- Cursor Cloud Agents: https://cursor.com/docs/cloud-agent
- Devin: https://docs.devin.ai/
- Factory: https://docs.factory.com/
- Jules: https://jules.google/docs y https://jules.google/docs/usage-limits

### Casos de empresa

- Stripe, Minions parte 1 (2026-02-09): https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents
- Stripe, Minions parte 2 (2026-02-19): https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
- Spotify, Honk parte 1 (2025-11-06): https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1
- Spotify, Honk parte 3 (2025-12-09): https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3
- Ramp, según InfoQ (2026-01-23): https://infoq.com/news/2026/01/ramp-coding-agent-platform/
- Ramp, post original (no lo leí): https://builders.ramp.com/post/why-we-built-our-background-agent
- Índice de Port «Inside the Software Factory»: https://software-factories.port.io/stripe

### Lecciones y estudios

- Simon Willison (2025-10-05): https://simonwillison.net/2025/Oct/5/parallel-coding-agents/
- Cognition, «Don't build multi-agents» (2025-06-12): https://cognition.com/blog/dont-build-multi-agents
- Faros, «AI Productivity Paradox» (2025-07-23): https://www.faros.ai/blog/ai-software-engineering
- METR, según TechCrunch (2025-07-11): https://techcrunch.com/2025/07/11/ai-coding-tools-may-not-speed-up-every-developer-study-shows
- PR rechazados de agentes (2026-02-04): https://arxiv.org/abs/2602.04226
- PR fallidos de agentes: https://arxiv.org/html/2601.15195v1
- Integración de PR de agentes: https://arxiv.org/html/2602.19441v1
