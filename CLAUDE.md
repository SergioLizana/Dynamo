# CLAUDE.md — Dynamo

Dynamo es una factoría de agentes personal para Claude Code: convierte ideas en tickets y deja que los agentes los
construyan, prueben y revisen hasta abrir un PR que aprueba una persona. Repositorio privado.

- Diseño: `documentation/agent-factory-plan.md` (léelo antes de proponer nada).
- Investigación de apoyo: `documentation/agent-factory-research.md` (consultar por secciones, no entera).
- Estado: etapa 2 (la unidad). Las etapas están en el plan, §8.

## Cómo trabajamos

- La factoría se construye con la factoría: a mano solo `/to-tasks`, `/implement` y el `reviewer`; el resto, como
  tickets (plan §8).
- «Completo» está fijado en el plan §8.1 y no se mueve. Al llegar, se pasa a un proyecto real.
- Nada se añade sin un problema real que lo pida. Las ideas que surjan van a `documentation/backlog.md`, no a un ticket.
- Cada skill, como mucho unas 150 líneas, si una skill requiere mas, se crearan otros ficheros y se referenciaran a ellos desde la skill. Sin scripts propios mientras Claude Code lo resuelva con una opción.
  Excepción: los guiones de workflow (`.claude/workflows/`), que ejecuta Claude Code.
- Se mide desde el primer ticket: las vueltas, por ticket; el coste, por lista (al acabar una, `/cost` de la sesión
  en el informe del PR). Al lanzar un ticket a mano no se anotan turnos ni coste.

## Convenciones

- Con el humano se habla en español. Skills, agentes y código, en inglés; la documentación de trabajo, en español.
- Los ficheros de `documentation/` llevan nombre en inglés y contenido en español.
- Los datos del proyecto (repositorio, tablero y sus estados, etiquetas, rama principal y de trabajo, comprobación
  automática, idioma de los documentos, dónde van backlog y especificaciones) van en `.claude/factory.md`. Skills y
  agentes los leen de ahí y no nombran ninguno.
- Skills en `.claude/skills/<nombre>/SKILL.md`; subagentes en `.claude/agents/<nombre>.md`.
- Finales de línea LF (`.gitattributes`).

## Límites

- Se puede hacer merge en una rama `release/x.y.z` sin preguntar (las ramas de ticket y de integración se fusionan
  ahí).
- A `main` solo llega lo que aprueba el humano: nunca merge ni push a `main` sin su autorización explícita.
- Push de cualquier otra rama, solo con autorización del humano.
- Nunca secretos en git (claves, tokens, `.env`).
- Cadenza (`E:\Proyectos\cadenza`) es solo referencia de textos: no se copia su código ni su estructura.
