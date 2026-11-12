// concepts.i18n.js — the texts of the concepts page, in English and Spanish under the same keys: the page's own texts and,
// for every concept of concepts.data.js, `concepts.<id>.title`, `.p1` and `.p2`, and `concepts.source.<id>` for each source.
// What is general is taken from Anthropic's documentation and says so; no price and no figure of a model.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'concepts.page.title': 'Concepts',
      'concepts.title': 'The concepts of working with an LLM',
      'concepts.lead':
        'Nine ideas that explain how Dynamo’s agents work and why it is built as it is. The general ones link the Anthropic documentation they come from, with the day it was read; the ones about Dynamo name the file or the epic they rest on.',
      'concepts.read': 'Read on',
      'concepts.files': 'In the repository:',
      'concepts.source.subagents': 'Anthropic: Subagents',
      'concepts.source.models': 'Anthropic: Models overview',
      'concepts.source.effort': 'Anthropic: Effort',
      'concepts.source.context': 'Anthropic: Context windows',
      'concepts.source.pricing': 'Anthropic: Pricing',

      'concepts.llm.title': 'An LLM',
      'concepts.llm.p1':
        'A large language model, an LLM, is a program that has learned from a very large amount of text how language continues. Given some text, it writes the text that most plausibly follows.',
      'concepts.llm.p2':
        'That is enough to answer questions, write code and use tools. Claude is a family of language models made by Anthropic.',

      'concepts.model.title': 'A model',
      'concepts.model.p1':
        'A model is one particular LLM, with its own name and version. Anthropic offers several at once, and they differ in how capable they are, how fast they answer and how much they cost to use.',
      'concepts.model.p2':
        'Choosing a model is choosing a balance between those three. Newer models replace older ones over time, so the current list lives in the documentation, not here.',

      'concepts.effort.title': 'The effort',
      'concepts.effort.p1':
        'The effort tells a model how much work to put into an answer. A low effort answers sooner and spends less; a high effort thinks longer and goes further on a hard problem.',
      'concepts.effort.p2':
        'It works with one model: the same model can be asked for a quick answer or for a careful one. Lower effort accepts some loss of capability in exchange for speed and cost.',

      'concepts.tokens.title': 'Tokens and cost',
      'concepts.tokens.p1':
        'A model reads and writes text in pieces called tokens: a short word is often one token, a long word several. The text the model reads is the input; the text it writes, including what it thinks before answering, is the output.',
      'concepts.tokens.p2':
        'Using a model is billed by the tokens read and written, and the two are priced separately. So a longer prompt, a longer answer and more thinking all cost more.',

      'concepts.context.title': 'The context window',
      'concepts.context.p1':
        'The context window is all the text a model can look at while it answers: the instructions, the whole conversation so far, the results of the tools it used and the answer it is writing. It is the model’s working memory.',
      'concepts.context.p2':
        'It has a limit, and more is not always better: as it fills, the model recalls less accurately. That is why what goes into the context matters as much as how much room is left.',

      'concepts.agent.title': 'An agent and a subagent',
      'concepts.agent.p1':
        'An agent is a model that works in a loop: it reads, uses tools, looks at the result and decides the next step until the job is done. A subagent is an agent that another one delegates a task to; it runs in its own context window, apart from the main conversation, and only its summary comes back.',
      'concepts.agent.p2':
        'Dynamo has two agents, the Builder and the Reviewer, each defined in its own file under agents/. The program launches each one as its own Claude Code run, with its own conversation, and reads its answer.',

      'concepts.two.title': 'Why two agents',
      'concepts.two.p1':
        'The Builder writes the change in its own copy of the repository. The Reviewer is a separate agent that only reads: it has no tool to edit, and it takes no part in the Builder’s conversation, so it sees only the ticket and the result and cannot be swayed by the Builder’s reasoning.',
      'concepts.two.p2':
        'An agent that judges its own work tends to say it is fine. Splitting building from judging, with a different context for each, gives a review that checks the change against the ticket’s checkboxes, with evidence.',

      'concepts.levels.title': 'Why levels',
      'concepts.levels.p1':
        'Each ticket carries a level of difficulty, low, medium or high, and Dynamo launches its Builder and its Reviewer with the model and effort of that level. An easy ticket costs less than one that crosses several modules.',
      'concepts.levels.p2':
        'Haiku is not among them: a cheap Builder that fails and repeats costs more than a good one at the first try. A ticket with no level runs as high. The starting values are in the code and each project can change them.',

      'concepts.why.title': 'Why Dynamo',
      'concepts.why.p1':
        'A coding agent is fast, but left alone on a long job it drifts: it forgets what was decided, stops to ask and calls its own work fine. Dynamo splits the job into small tickets and puts a process around each one.',
      'concepts.why.p2':
        'A program, not an agent, runs the loop: order, rounds, merges and stops are plain code. Whoever builds does not judge, and the project’s own checks are the gate before the Reviewer.'
    },
    es: {
      'concepts.page.title': 'Conceptos',
      'concepts.title': 'Los conceptos de trabajar con un LLM',
      'concepts.lead':
        'Nueve ideas que explican cómo funcionan los agentes de Dynamo y por qué está construido así. Las generales enlazan la documentación de Anthropic de la que salen, con el día en que se leyó; las de Dynamo nombran el fichero o la épica en que se apoyan.',
      'concepts.read': 'Leído el',
      'concepts.files': 'En el repositorio:',
      'concepts.source.subagents': 'Anthropic: Subagents',
      'concepts.source.models': 'Anthropic: Models overview',
      'concepts.source.effort': 'Anthropic: Effort',
      'concepts.source.context': 'Anthropic: Context windows',
      'concepts.source.pricing': 'Anthropic: Pricing',

      'concepts.llm.title': 'Un LLM',
      'concepts.llm.p1':
        'Un modelo de lenguaje grande, un LLM, es un programa que ha aprendido de una enorme cantidad de texto cómo continúa el lenguaje. Dado un texto, escribe el que lo sigue con más probabilidad.',
      'concepts.llm.p2':
        'Eso basta para responder preguntas, escribir código y usar herramientas. Claude es una familia de modelos de lenguaje hecha por Anthropic.',

      'concepts.model.title': 'Un modelo',
      'concepts.model.p1':
        'Un modelo es un LLM concreto, con su nombre y su versión. Anthropic ofrece varios a la vez, y se diferencian en lo capaces que son, en lo rápido que responden y en lo que cuesta usarlos.',
      'concepts.model.p2':
        'Elegir un modelo es elegir un equilibrio entre esas tres cosas. Los modelos nuevos sustituyen a los viejos con el tiempo, así que la lista vigente está en la documentación, no aquí.',

      'concepts.effort.title': 'El esfuerzo',
      'concepts.effort.p1':
        'El esfuerzo le dice a un modelo cuánto trabajo poner en una respuesta. Un esfuerzo bajo responde antes y gasta menos; un esfuerzo alto piensa más tiempo y llega más lejos en un problema difícil.',
      'concepts.effort.p2':
        'Actúa sobre un mismo modelo: se le puede pedir una respuesta rápida o una cuidadosa. Un esfuerzo menor acepta perder algo de capacidad a cambio de velocidad y coste.',

      'concepts.tokens.title': 'Tokens y coste',
      'concepts.tokens.p1':
        'Un modelo lee y escribe el texto en trozos llamados tokens: una palabra corta suele ser un token, una larga varios. El texto que lee es la entrada; el que escribe, incluido lo que piensa antes de responder, es la salida.',
      'concepts.tokens.p2':
        'Usar un modelo se factura por los tokens leídos y escritos, y cada tipo tiene su precio. Por eso un prompt más largo, una respuesta más larga y más pensamiento cuestan más.',

      'concepts.context.title': 'La ventana de contexto',
      'concepts.context.p1':
        'La ventana de contexto es todo el texto que un modelo puede mirar mientras responde: las instrucciones, toda la conversación hasta ahora, los resultados de las herramientas que usó y la respuesta que está escribiendo. Es la memoria de trabajo del modelo.',
      'concepts.context.p2':
        'Tiene un límite, y más no siempre es mejor: a medida que se llena, el modelo recuerda con menos exactitud. Por eso importa tanto qué entra en el contexto como cuánto espacio queda.',

      'concepts.agent.title': 'Un agente y un subagente',
      'concepts.agent.p1':
        'Un agente es un modelo que trabaja en bucle: lee, usa herramientas, mira el resultado y decide el siguiente paso hasta terminar el trabajo. Un subagente es un agente al que otro le delega una tarea; corre en su propia ventana de contexto, aparte de la conversación principal, y solo vuelve su resumen.',
      'concepts.agent.p2':
        'Dynamo tiene dos agentes, el Builder y el Reviewer, cada uno definido en su propio fichero de agents/. El programa lanza cada uno como una ejecución propia de Claude Code, con su propia conversación, y lee su respuesta.',

      'concepts.two.title': 'Por qué dos agentes',
      'concepts.two.p1':
        'El Builder escribe el cambio en su propia copia del repositorio. El Reviewer es otro agente que solo lee: no tiene herramienta para editar y no participa en la conversación del Builder, así que ve solo el ticket y el resultado y no puede dejarse llevar por el razonamiento del Builder.',
      'concepts.two.p2':
        'Un agente que juzga su propio trabajo tiende a decir que está bien. Separar construir de juzgar, con un contexto distinto para cada uno, da una revisión que comprueba el cambio contra las casillas del ticket, con evidencia.',

      'concepts.levels.title': 'Por qué niveles',
      'concepts.levels.p1':
        'Cada ticket lleva un nivel de dificultad, low, medium o high, y Dynamo lanza su Builder y su Reviewer con el modelo y el esfuerzo de ese nivel. Un ticket fácil cuesta menos que uno que atraviesa varios módulos.',
      'concepts.levels.p2':
        'Haiku no está entre ellos: un Builder barato que falla y repite cuesta más que uno bueno a la primera. Un ticket sin nivel corre como high. Los valores de partida están en el código y cada proyecto puede cambiarlos.',

      'concepts.why.title': 'Por qué Dynamo',
      'concepts.why.p1':
        'Un agente de código es rápido, pero a solas en un trabajo largo se desvía: olvida lo decidido, se detiene a preguntar y da su propio trabajo por bueno. Dynamo parte el trabajo en tickets pequeños y pone un proceso alrededor de cada uno.',
      'concepts.why.p2':
        'Un programa, no un agente, lleva el bucle: el orden, las rondas, las fusiones y las paradas son código normal. Quien construye no juzga, y las comprobaciones del propio proyecto son la puerta antes del Reviewer.'
    }
  });
})();
