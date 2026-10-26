# CLAUDE.md — Dynamo

Dynamo es una factoría de agentes personal para Claude Code: convierte ideas en tickets y deja que los agentes los
construyan, prueben y revisen hasta abrir un PR que aprueba una persona. Repositorio privado.

- Diseño: `documentation/plan-factoria-de-agentes.md` (léelo antes de proponer nada).
- Investigación de apoyo: `documentation/investigacion-factorias-de-agentes.md` (consultar por secciones, no entera).
- Estado: etapa 0 (arranque). Las etapas están en el plan, §8.

## Cómo trabajamos

- La factoría se construye con la factoría: a mano solo `/to-tasks`, `/implement` y el `reviewer`; el resto, como
  tickets (plan §8).
- «Completo» está fijado en el plan §8.1 y no se mueve. Al llegar, se pasa a un proyecto real.
- Nada se añade sin un problema real que lo pida. Las ideas que surjan van a `documentation/despues.md`, no a un ticket.
- Cada skill, como mucho unas 150 líneas, si una skill requiere mas, se crearan otros ficheros y se referenciaran a ellos desde la skill. Sin scripts propios mientras Claude Code lo resuelva con una opción.
- Se mide desde el primer ticket: turnos, vueltas y coste.

## Convenciones

- Con el humano se habla en español. Skills, agentes y código, en inglés; la documentación de trabajo, en español.
- Rama principal: `main`. Rama de trabajo: la `release/x.y.z` en curso (ahora `release/0.1.0`); todo se hace ahí antes
  de llegar a `main`. Tickets: issues de GitHub en `SergioLizana/Dynamo`.
- Skills en `.claude/skills/<nombre>/SKILL.md`; subagentes en `.claude/agents/<nombre>.md`.
- Comprobación automática: aún no hay; se define al escribir `/implement`.
- Finales de línea LF (`.gitattributes`).

## Límites

- Se puede hacer merge en una rama `release/x.y.z` sin preguntar (las ramas de ticket y de integración se fusionan
  ahí).
- A `main` solo llega lo que aprueba el humano: nunca merge ni push a `main` sin su autorización explícita.
- Push de cualquier otra rama, solo con autorización del humano.
- Nunca secretos en git (claves, tokens, `.env`).
- Cadenza (`E:\Proyectos\cadenza`) es solo referencia de textos: no se copia su código ni su estructura.
