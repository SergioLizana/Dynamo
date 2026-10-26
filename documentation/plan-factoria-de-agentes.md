# Dynamo: la factoría de agentes, punto de partida

Fecha: 2026-10-26. Origen: conversación sobre Cadenza, la investigación del enfoque de Matt Pocock y un esquema de
factoría de otra persona. Estado: borrador de diseño; no hay nada construido.

Revisado el 2026-10-26 contra `investigacion-factorias-de-agentes.md` (en adelante, «la investigación»). La idea no
cambia: la factoría la construimos nosotros, poco a poco, sobre un proyecto real. Lo que se añade son reglas que la
evidencia da por imprescindibles: una comprobación automática antes del revisor, un tope de 2 vueltas, medir desde el
primer ticket y listas cortas.

Cambio del 2026-10-26: **la factoría se construye con la factoría.** Se escribe a mano lo mínimo (§8, etapa 1) y el
resto lo construye ella misma, ticket a ticket. Al llegar a «completo» (§8.1) se pasa a un proyecto real.

## 1. Qué quiero

Un software en un **repositorio privado** que sea una **factoría de agentes**, de momento solo con Claude (Claude
Code), con la que construir **otros** programas de forma organizada, sin hacer vibecoding directamente en la terminal.

- No es un producto open source. Es una herramienta personal y, a la vez, una forma de estudiar IA, agentes, SDD
  (desarrollo guiado por especificaciones) y automatización.
- **Es nuestra.** Las skills y la lógica de la factoría las escribimos nosotros, para entender cada pieza. Lo que no
  reinventamos es la fontanería que Claude Code ya trae (ver §6.3).
- **El cuello de botella soy yo.** La factoría debe trabajar sin que yo tenga que vigilar el PC cada pocas horas.
  Intervengo en dos momentos: al aprobar la lista de tareas y al revisar los PR del final.
- Que todo acabe en PR que apruebo después me parece bien, por ahora.

## 2. Por qué no seguir con Cadenza

Cadenza iba en esta dirección, pero acabó siendo una mezcla de ideas: una factoría, un producto open source y un panel
propio, todo a la vez y sin cerrar primero la factoría. Señales concretas, medidas el 2026-10-25 y 26:

- Un plan de 28 tareas para «adelgazar el orquestador», y el orquestador **creció** de 138 a 155 líneas mientras el
  tope de su test subía de 138 a 250.
- Casi todas las tareas eran Cadenza mejorándose a sí misma: tareas para arreglar cómo se crean tareas. Cadenza no se
  usó para construir ningún otro software.
- Cada arreglo pedía otro: las copias de trabajo trajeron un comando de Python y copiar la configuración a mano, y
  eso pidió otra tarea para quitarlo.
- El proceso pesaba tanto que sus propias puertas no se cumplían (una tarea se aceptó con un criterio sin cumplir).
- De una idea a una tarea lista había demasiados pasos: documento, plan, propuestas, preguntas, puerta Define y
  bucle. Era fácil perderse.
- Maquinaria sin usar: 8 roles, perfiles, slots, contratos, un harness de 2.183 líneas, el kit duplicado con su
  sincronización, dos orquestadores y un panel HTML de 1.870 líneas cuyas funciones no necesitaba.

**Decisión:** empezar un repositorio nuevo. Cadenza se congela como referencia (no se borra, no se invierte más) y de
ella se traen **textos**, no código. Recortarla habría costado más que escribir cinco ficheros nuevos y habría
arrastrado nombres, reglas y tests de cosas que ya no existen.

**El riesgo de «algo nuestro»:** también fue lo que hizo crecer Cadenza. Lo que lo evita es la regla 2 de §3: cada
pieza nace porque el proyecto real la necesita, no porque sea una buena idea.

## 3. Reglas de trabajo para no repetir lo mismo

1. **La factoría es su primer cliente, hasta «completo».** Sus propias piezas son los primeros tickets. Cada etapa se
   da por hecha cuando se ha usado en tickets reales, no cuando está programada. Al llegar a «completo» (§8.1), el
   cliente pasa a ser un proyecto real, aunque falten cosas.
2. **Nada se añade sin un problema real que lo pida.** Si algo duele, se anota dónde y cuánto; solo entonces se
   añade una pieza.
3. **Primero fiable, luego en paralelo.** Una pieza que falla una de cada tres veces, multiplicada por seis, da dos PR
   malos que revisar y te devuelve el cuello de botella.
4. **Medir desde el primer ticket.** Turnos, vueltas y coste por ticket, anotados desde la etapa 2; sin datos no se
   cambia nada.
5. **Sin interfaz propia.** La lista de tareas, el tablero, los PR y las dependencias ya los da GitHub.
6. **La comprobación automática manda.** Un ticket no llega al revisor si no pasan sus tests, build y lint. La calidad
   la decide el verificador, no el número de agentes (investigación §7.3, §8.2).

## 4. El enfoque de Matt Pocock

Leído en sus skills públicas (`to-tickets`, `implement`, `implement-spec`), el README de Sandcastle y el README de su
repositorio de skills, el 2026-10-25.

**La idea:** pocas skills en Markdown, sin harness, sin máquina de estados y sin interfaz.

1. **Grill:** el agente conversa la idea contigo, comprueba hechos en el repositorio en vez de preguntarlos y cierra las
   decisiones.
2. **To-spec:** escribe la especificación con secciones fijas.
3. **To-tickets:** parte la especificación en tickets.
   - Cortes verticales: cada ticket entrega algo que funciona de punta a punta.
   - Cada uno cabe en una ventana de contexto limpia y se comprueba por sí solo.
   - Cada uno tiene «Blocked by». La «frontera» son los tickets cuyos bloqueos ya están hechos.
   - **El humano aprueba la lista entera una vez:** tamaño, que cada bloqueo sea real y qué juntar o partir.
4. **Implement:** un ticket por sesión, con el contexto limpio entre uno y otro. Avisa de no simular paralelismo con
   varias sesiones en la misma carpeta.
5. **Implement-spec (el paralelo):**
   - una rama de integración;
   - un implementador por ticket de la frontera, cada uno en su propia copia de trabajo (worktree) y rama, en segundo
     plano, que antes de terminar trae lo último de la rama de integración;
   - un fusionador que mete cada resultado en la rama de integración;
   - nuevos implementadores en cuanto una fusión cambia la frontera;
   - una sola revisión al final y **un PR** para el humano;
   - **sin puertas humanas durante la ejecución.**

   Lo que no dice: qué hacer ante un conflicto de fusión o un ticket que falla (investigación §4.2). Eso lo añade este
   diseño.
6. **Sandcastle:** la versión desatendida del todo, con los agentes en contenedores y varias estrategias de rama
   (`head`, `merge-to-head`, `branch`).
7. **Gestor de tareas configurable:** su configuración inicial pregunta dónde viven los tickets (GitHub, GitLab,
   ficheros locales u otro).

Lo que él mismo reconoce: delegar así aumenta la revisión humana, y aún no sabe cómo mantener pequeños los PR. (Sin
verificar: la investigación no encontró la cita. No usarlo como argumento.)

**Lo que más cambia respecto a Cadenza:** no hay puerta de aprobación por tarea. El ticket aprobado es el contrato. Eso
es lo que ahorra turnos.

**Cómo se usa aquí:** sus skills se leen como **referencia** antes de escribir las nuestras; no se copian ni se
instalan tal cual.

Fuentes:
- https://github.com/mattpocock/skills
- https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md
- https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/to-tickets/SKILL.md
- https://github.com/mattpocock/sandcastle
- https://www.dandoescode.com/blog/matt-pococks-skills-choosing-the-right-workflow

## 5. Otro esquema de referencia

Un esquema de factoría de otra persona (captura del 2026-10-26):

```text
Entrada → Spec writer → Builder → [Seguridad | UX | UI | Código] → Approver → ¿Humano? → Main o PR → Producción
                                   (cuatro revisores en paralelo)
```

| Pieza | Qué hace | En este diseño |
|---|---|---|
| Entrada + Spec writer | La petición pasa a especificación | `/discover` + `/to-request` |
| (no aparece) | Partir en tickets que caben en un contexto | `/to-tasks`: lo aporta Pocock y aquí falta |
| Builder | Implementa | `/implement` |
| (no aparece) | Comprobación automática: tests, build, lint | Dentro de `/implement`, antes del revisor |
| 4 revisores | Cada uno mira un enfoque | Un revisor al principio; por enfoque cuando haga falta |
| Approver | Junta los veredictos y decide | Lo hace `/implement`: si hay fallos, vuelve al Builder |
| ¿Humano? → Main / PR | Decide si hace falta una persona | Al principio, siempre PR |
| Producción | Despliegue | Fuera de alcance al principio |

**Lo bueno:**
- revisores por enfoque, que dan revisiones más finas;
- un aprobador que junta veredictos antes de molestar a la persona;
- decidir según el riesgo si hace falta una persona.

**Con cuidado:**
- **No dibuja el bucle.** Si un revisor falla, algo tiene que volver al Builder con los hallazgos, con un límite de
  vueltas.
- **Cuatro revisores cuestan cuatro veces más por vuelta.** En Cadenza, la tarea que usó 3 enfoques × 2 rondas fue la
  más cara de todas: 60,5 M de lecturas de caché.
- **Ir a main sin persona** es lo último que se activa: primero, que el aprobador acierte en muchas tareas con PR, y
  medido. Ninguna empresa de la investigación lo hace (investigación §6.3).

## 6. El diseño

### 6.1 El flujo

```text
Idea → /discover → /to-request → /to-tasks (apruebo la lista, 5-8 tickets)    ← yo, una vez
                         ↓
/run: mientras queden tickets
        frontera = tickets cuyos bloqueos ya están fusionados
        por cada uno (hasta N a la vez), en segundo plano y en su copia de trabajo:
            /implement:
                Builder → comprobación (tests, build, lint) → ¿pasa? no → Builder
                                        sí → Revisor → ¿pasa? no → Builder
                máximo 2 vueltas en total
            pasa → se fusiona en la rama de integración → tests otra vez en la rama
            no pasa tras 2 vueltas → «bloqueado» con su motivo; sigue con el resto
            los que dependen de un bloqueado se saltan y van al informe
                         ↓
PR de la rama de integración + informe (bloqueados, saltados, coste)          ← yo, al final
```

- **N** es solo cuántos tickets van a la vez. Empieza en 2 (investigación §7.9).
- **El tope de vueltas es 2**, fijo. Stripe deja como mucho 2 rondas de CI (investigación §6.2, §8.2).
- **Listas de 5-8 tickets.** Así el PR final se puede leer. Si aun así cuesta, se pasa a un PR por ticket contra la
  rama de integración (ver §10, pregunta 2). Los PR grandes se revisan peor y se fusionan menos (investigación §7.1,
  §7.2, §8.5).

### 6.2 Las piezas

Todas las escribimos nosotros. Antes de escribir cada skill se leen las de Pocock que hacen lo mismo
(`grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `implement-spec`).

| Pieza | Tipo | Qué hace | Qué no hace |
|---|---|---|---|
| `/discover` | skill | Conversa la idea, comprueba hechos en el repositorio y cierra las decisiones. Al final dice si cabe en un ticket o necesita una especificación | No escribe la especificación ni crea tickets |
| `/to-request` | skill | Escribe la especificación con la plantilla, en la misma sesión | No decide nada nuevo |
| `/to-tasks` | skill | Propone la lista de tickets (título, bloqueado por, qué entrega, cuándo está hecho), con 5-8 como mucho; la ajusta conmigo hasta que la apruebo y crea todos los tickets | No implementa ni planifica a fondo |
| `/implement <ticket>` | skill | La unidad: rama, tests, implementación, **comprobación automática** (tests, build, lint; si falla, ni commit ni revisor), revisión, vuelta al Builder si falla (máx. 2 en total), commit. Anota turnos, vueltas y coste en el ticket | No fusiona en main |
| `/run` | skill | La línea de montaje: calcula la frontera, lanza `/implement` en paralelo en copias de trabajo, fusiona en la rama de integración, vuelve a pasar los tests, desbloquea y sigue; al final abre el PR y da un informe | No implementa; su estado vive en los tickets, no en la conversación |
| `reviewer` | subagente | Solo lectura; revisa el cambio contra las casillas del ticket y **si se sale del ticket**; devuelve PASA o FALLA con evidencias | No edita ficheros |

Por qué el revisor mira si el agente se sale del ticket: es el fallo más común de un agente desatendido; el juez de
Spotify veta una de cada cuatro sesiones por eso (investigación §7.4). Va en el mismo revisor, no en un juez aparte.

### 6.3 Lo nuestro y lo que usamos de Claude Code

La lógica es nuestra; la fontanería, la de Claude Code. `/run` sigue siendo nuestro aunque por debajo use opciones
que ya existen.

| Lo nuestro | Lo que usamos por debajo (investigación) |
|---|---|
| Qué ticket va ahora (frontera), cuándo se bloquea, qué se salta, qué va en el informe | Copias de trabajo: subagentes con `isolation: worktree` o `git worktree add` (§3.2, §3.3) |
| El bucle Builder → comprobación → revisor, con tope de 2 | Hook `Stop` para la comprobación (§3.9) |
| Qué se anota por ticket | `claude -p --output-format json` da `total_cost_usd`; `--max-turns` y `--max-budget-usd` ponen topes (§3.8) |
| Cuándo se fusiona y qué pasa si choca | Sesiones en segundo plano (`claude --bg`) o en la nube, que abren PR (§3.4, §3.14) |

En la etapa 3 se prueba cuál de esas opciones de fontanería va mejor antes de escribir `/run`. `implement-spec` y
Projects se prueban como **comparación**, para ver qué resuelven ellos y qué no, no para sustituir lo nuestro.

### 6.4 Estructura del repositorio

**Al principio, las skills viven en el `.claude/` de este mismo repositorio**, porque la factoría es su primer
cliente. Se sacan a un plugin cuando llegue el proyecto real (etapa 4), que es el segundo cliente. Antes, un plugin
aparte repetiría el «kit duplicado con sincronización» de Cadenza (§2).

```text
dynamo/
  CLAUDE.md             # qué es, comprobación automática, rama principal, tickets en GitHub; enlaza documentation/
  .claude/
    skills/
      discover/SKILL.md
      to-request/SKILL.md
      to-tasks/SKILL.md
      implement/SKILL.md
      run/SKILL.md
    agents/
      reviewer.md
    templates/
      request.md        # problema, solución, qué cambia para quien lo usa, decisiones, cómo se prueba, fuera de alcance, notas
      ticket.md         # problema, qué entrega, criterios de aceptación como casillas, bloqueado por, fuera de alcance
  .worktreeinclude      # qué se copia a cada copia de trabajo (.env, etc.)
  documentation/
```

Cuando llegue el proyecto real, se añade `.claude-plugin/plugin.json` y las skills pasan a `skills/`, `agents/` y
`templates/` en la raíz, para instalarlas allí como plugin.

**La comprobación automática de la factoría:** casi todo es Markdown, así que hay pocos tests. Se comprueba el formato
(front matter de skills y agentes, y `claude plugin validate` cuando haya plugin) y los tests de los scripts, si llega a
haber alguno. La prueba de verdad es usar cada pieza; por eso esta fase no se alarga.

Si llega a haber plugin, se instala **a nivel de proyecto**: los plugins de `.claude/settings.local.json` no llegan a
las copias de trabajo (investigación §3.3).

### 6.5 Dónde viven los tickets

**Issues de GitHub** en el repositorio privado de la factoría, y después en el del proyecto real: lista, tablero (Projects), relación «blocked by»
y enlace a los PR, sin construir nada. Solo GitHub hasta que haga falta otra cosa (regla 2).

Por comprobar en la etapa 1:
- **Sin verificar:** que la relación «blocked by» nativa de GitHub sirva para calcular la frontera.
- **Sin verificar:** GitHub cierra los issues automáticamente solo cuando un PR se fusiona en la rama por defecto. Si la frontera
  mira los issues cerrados, no avanzará mientras se trabaja en la rama de integración. Probablemente harán falta
  etiquetas (`hecho-en-integracion`, `bloqueado`).

## 7. Lo que hay que resolver para trabajar sin mí

- **Permisos.** Una ejecución desatendida no puede pararse a preguntar si puede editar un fichero. Hay que decidir qué
  se le permite (lista de comandos y rutas) o aislarla en un contenedor, como Sandcastle (ver §10, pregunta 4).
- **Que no se quede parada esperándome.** El modo `auto` vuelve a preguntar tras 3 bloqueos seguidos o 20 en total, y
  una sesión en segundo plano se queda en «Needs input» (investigación §3.4, §3.12). Hace falta
  `--permission-prompts none` o un tiempo máximo.
- **Windows.** No hay sandbox de Claude Code en Windows nativo, y las reglas de «no volver a preguntar» se guardan en
  cada copia de trabajo y se pierden al borrarla (investigación §3.3, §8.6). La nube o WSL2 lo resuelven.
- **Límites de uso.** Varios agentes a la vez gastan la ventana de uso mucho más rápido, y nunca se ha medido cuánto
  cabe. `/run` tiene que poder pararse por límite y retomarse sin perder nada. En modo `-p` o en segundo plano, un
  workflow dinámico falla al llegar al límite en vez de esperar (investigación §3.6).
- **Coste.** Tope por ticket con `--max-budget-usd` (ver §10, pregunta 6). Si se usa Projects, cada hilo va en Opus con
  esfuerzo alto por defecto (investigación §3.15).
- **El PC encendido.** En local, sí. La alternativa son sesiones en la nube que abren PR solas; se comprueba en la
  etapa 0 qué ofrece la cuenta.
- **Copias de trabajo.**
  - Salen de la rama principal, no de la de integración, salvo que se configure `worktree.baseRef: "head"` o se creen
    con `git worktree add` (investigación §3.3). Si no, los tickets no ven el trabajo del que dependen.
  - Una copia nueva no trae `.env` ni dependencias: hace falta `.worktreeinclude` y un paso de instalación, o los tests
    fallarán en falso.
  - Con `-p` las copias no se borran solas: `/run` las limpia al terminar.
- **`claude -p` y la confianza.** Ejecuta los hooks y servidores MCP del proyecto sin preguntar si confías en la
  carpeta (investigación §3.8). Solo se usa en proyectos propios.
- **El cuello de botella pasa a la revisión.** Lo mitigan listas de 5-8 tickets, la comprobación automática, el
  revisor dentro del bucle y un commit por ticket dentro del PR.
- **Un ticket malo escondido en el PR grande.** El peor fallo es un cambio que pasa los tests pero hace otra cosa
  (investigación §7.3, §7.4). Lo mitigan el revisor que mira si se sale del ticket y el informe por ticket.
- **Choques al fusionar.** Antes de fusionar, cada ticket trae lo último de la rama de integración y vuelve a pasar los
  tests; si choca, se marca bloqueado y no se resuelve a ciegas. **Después de cada fusión, los tests se pasan otra vez
  en la rama de integración:** dos tickets pueden fusionarse sin conflicto y romper algo juntos (investigación §7.6).
- **El contexto del coordinador.** `/run` no lee diffs ni registros enteros: cada implementador devuelve un resumen
  corto y el estado vive en los tickets.
- **Piezas en beta.** Agent view, Projects y las tareas programadas están en vista previa y cambian casi cada semana
  (investigación §7.12). Se prueban antes de apoyarse en ellas.

## 8. Etapas

Lo mínimo se escribe a mano; el resto lo construye la propia factoría.

| Etapa | Qué tengo al acabar | Hecha cuando |
|---|---|---|
| 0. Arranque | Repositorio privado `SergioLizana/Dynamo` clonado en `E:\Proyectos\Dynamo`, `CLAUDE.md` corto; una hora mirando qué ofrece la cuenta (Projects, sesiones en la nube, sesiones en segundo plano) | El repositorio existe, `gh` tiene sesión y sé qué opciones tengo |
| 1. A mano | `/to-tasks`, `/implement`, el `reviewer` y la plantilla de ticket, escritos en conversación tras leer los de Pocock. Este plan hace de especificación, así que aún no hacen falta `/discover` ni `/to-request` | `/to-tasks` parte este plan en una lista de 5-8 tickets en GitHub que entiendo sin releerlos, y sé cómo marcar «bloqueado por» y «hecho» |
| 2. La unidad | `/implement` construye esos tickets de uno en uno: la comprobación automática, el tope de 2 vueltas, `/discover`, `/to-request`, la plantilla de petición; turnos, vueltas y coste anotados en cada ticket | 3 tickets **seguidos** terminan en PR que acepto, sin que yo intervenga, con sus datos anotados |
| 3a. Paralelo simple | `/implement` construye `/run` para N = 2 sobre tickets **sin dependencias entre sí**; antes, probar qué fontanería va mejor (subagentes en copia, `claude --bg`, nube) y comparar con `implement-spec` y Projects | Dos tickets van a la vez y terminan en PR sin que yo intervenga |
| 3b. Línea de montaje | `/run` construye lo que le falta: frontera, rama de integración, fusión, tests tras cada fusión, saltar los dependientes de un bloqueado e informe | Una lista de tickets con dependencias termina en un PR sin que yo intervenga por el camino: **«completo»** |
| 4. Proyecto real | Las skills pasan a plugin y se instalan en el proyecto real; la factoría se usa allí | La primera lista real del proyecto termina en un PR |
| 5. Mejorar según datos | Revisores por enfoque, decisión de si hace falta persona, más N, nube… | Cada mejora responde a un problema medido en el proyecto real |

La medición ya no es una etapa: empieza en la 2. La rama de integración con fusión automática va en la 3b porque es
lo único que la investigación marca como «no probado» (§8.4), y hay pocas tareas que se puedan hacer de verdad en
paralelo (§7.6).

### 8.1 Qué es «completo» y las barreras para no crecer

**«Completo»** se fija ahora y no se mueve: las 6 piezas de §6.2 funcionan y una lista de tickets con dependencias
termina en un PR sin que yo intervenga (etapa 3b). Ni una pieza más.

Barreras mientras la factoría se construye a sí misma:
- **Lo que se me ocurra por el camino** va a una lista «después del proyecto real» (`documentation/despues.md`), no a
  un ticket.
- **Tope de tamaño:** cada skill, como mucho unas 150 líneas. Sin scripts propios mientras Claude Code lo resuelva con
  una opción.
- **Al llegar a «completo» se pasa al proyecto real**, aunque falten cosas. Las mejoras de la etapa 5 salen de lo que
  duela allí, no de la propia factoría.
- **Señal de alarma:** si un ticket sirve para arreglar cómo se crean tickets y no lo pide un fallo medido, es el
  camino de Cadenza (§2). Se para y se anota.

## 9. Qué traer de Cadenza (`E:\Proyectos\cadenza`)

Solo como texto de referencia, adaptándolo. Para las skills de definir tareas, la referencia principal son las de
Pocock (§4); los textos de Cadenza son secundarios, para no arrastrar su ceremonia.

| Qué | Dónde está en Cadenza | Para qué |
|---|---|---|
| Prompt del revisor | `kit/ai/agents/reviewer.md` | Base del `reviewer`: revisa contra criterios, no edita, devuelve PASA/FALLA con evidencias |
| Revisores por enfoque | `.claude/agents/reviewer-{code,errors,security,tests,ui}.md` | Para la etapa 5 |
| Formato de preguntas y reglas de escritura | `kit/ai/templates/document-style.md` | Preguntas con opciones y una recomendada; prosa clara |
| Plantilla de tarea | `kit/ai/templates/task.md` | Criterios de aceptación comprobables |
| Propuestas ya pensadas | `work/proposals/resolved/de-idea-a-tareas.md`, `plan-legible.md` | Ideas sueltas para `/discover`, `/to-request`, `/to-tasks` y las reglas de escritura |
| Medidor de tokens | `mods/sdd-metrics` | Solo si `total_cost_usd` de `claude -p` no basta |
| Investigación de copias de trabajo | `docs/cadenza/research/prueba-copias-de-trabajo.md` | Etapa 3a: qué funciona dentro de un worktree |
| Plan con el análisis de Pocock | `docs/cadenza/requests/adelgazar-el-orquestador-tareas.md` (anexo 5.9) | Contexto |

Lecciones del runtime de Claude Code que siguen valiendo:
- El orquestador funciona mejor como skill en la sesión principal que como subagente: así puede hablar con la persona,
  y no gasta niveles de anidación.
- Claude Code tiene una herramienta para mover la sesión a una copia de trabajo existente (`EnterWorktree`) y otra para
  lanzar subagentes aislados en su propia copia y en segundo plano: candidatas para `/run`.
- Los plugins instalados a nivel local (`.claude/settings.local.json`) no llegan a una copia de trabajo nueva.
- Nota: un subagente no puede escribir ficheros llamados `FINDINGS.md` ni `ANALYSIS.md` (verificado con Claude Code
  2.1.296). Solo importa si la factoría usa esos nombres; no se diseña en torno a ello.

## 10. Preguntas abiertas

Solo las que tengo que decidir yo, con la opción recomendada. Ya respondidas: N = 2 para empezar (investigación §7.9)
y tickets solo en GitHub (regla 2).

1. **¿Qué proyecto real se construye al llegar a «completo»?** Ya tengo uno pensado; se concreta en la etapa 4.
   Recomendado: que se pueda iterar poco a poco, con tests fáciles y poco riesgo; nada que maneje datos sensibles al
   principio (investigación §8.2).
2. **¿Un PR por lista o uno por ticket?** Recomendado: rama de integración y un PR por lista, con 5-8 tickets como
   mucho; si el PR final cuesta de revisar, un PR por ticket contra la rama de integración (investigación §8.5). Un PR
   por ticket contra main me vuelve a poner de cuello de botella a mitad del camino.
3. **¿Ejecución en local o en la nube?** Se decide en la etapa 0, mirando la cuenta. Recomendado: la nube si está
   disponible, porque resuelve a la vez el PC encendido y la falta de sandbox en Windows (investigación §8.6).
4. **¿Qué permisos se dan a una ejecución desatendida?** Recomendado en local: modo `auto` con lista blanca y
   `--permission-prompts none`. `bypassPermissions` nunca fuera de un contenedor (investigación §3.12, §8.8).
5. **¿Qué pasa con los tickets que dependen de uno bloqueado?** Recomendado: se saltan, se listan en el informe y el PR
   se abre solo con lo terminado.
6. **¿Tope de coste por ticket y por lista?** Recomendado: ponerlo con `--max-budget-usd` y ajustarlo después de los 3
   primeros tickets.
