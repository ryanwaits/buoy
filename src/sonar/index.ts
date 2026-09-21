/**
 * Sonar: a provider-neutral client for decision models. Send a state and typed
 * questions, get probabilities back. Jev (TypeSafe System One) is the first
 * adapter; anything that can answer these question shapes can be another.
 *
 * Imports nothing from Buoy, so it can move to its own package as it stands.
 */

/** Text, or JSON the model reads as structure. */
export type Entry = string | number | boolean | null | Entry[] | { [key: string]: Entry };

/** Yes/no. The answer is one probability that the answer is yes. */
export type Noul = {
  type: 'noul';
  instructions: Entry;
  criteria?: { true?: Entry; false?: Entry };
};

/** One of several labelled options. */
export type Choice = { type: 'choice'; instructions: Entry; criteria: Record<string, Entry> };

/** A position on an ordered rubric, index 0 upward. */
export type Score = { type: 'score'; instructions: Entry; criteria: Entry[] };

export type Question = Noul | Choice | Score;

export type Answer<Q extends Question> = Q extends Noul
  ? { type: 'noul'; probability: number }
  : Q extends Choice
    ? { type: 'choice'; choice: string; probabilities: Record<string, number> }
    : { type: 'score'; score: number; probabilities: Record<string, number> };

export type Request<Q extends Record<string, Question>> = { state: Entry; questions: Q };

export type Result<Q extends Record<string, Question>> = {
  /** The concrete model that answered, e.g. `jev-1.13.0` */
  model: string;
  answers: { [K in keyof Q]: Answer<Q[K]> };
  usage: { inputTokens: number; outputTokens: number };
};

export type Classifier = {
  name: string;
  /** Every question is answered against the same state, independently of the others. */
  evaluate<Q extends Record<string, Question>>(request: Request<Q>): Promise<Result<Q>>;
};

type JevAnswer = {
  type: Question['type'];
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
};

/**
 * Jev, TypeSafe's System One model. Reads `TYPESAFE_API_KEY` unless a key is
 * passed. `@typesafe-ai/sdk` is loaded on first use so nothing else pays for it.
 */
export function jev(options: { apiKey?: string; model?: string } = {}): Classifier {
  const model = options.model ?? 'jev-latest';
  return {
    name: model,
    async evaluate(request) {
      const { TypeSafeClient } = await import('@typesafe-ai/sdk').catch(() => {
        throw new Error(
          'Jev needs the TypeSafe SDK. Install it next to Buoy: bun add -d @typesafe-ai/sdk',
        );
      });
      const client = new TypeSafeClient(options.apiKey ? { apiKey: options.apiKey } : {});
      const result = await client.systemOne({
        model,
        state: request.state,
        questions: request.questions,
      } as never);
      const answers = Object.fromEntries(
        Object.entries(result.answers as Record<string, JevAnswer>).map(([id, a]) => [
          id,
          a.type === 'noul'
            ? { type: 'noul', probability: a.noul ?? 0 }
            : a.type === 'choice'
              ? { type: 'choice', choice: a.choice ?? '', probabilities: a.probabilities ?? {} }
              : { type: 'score', score: a.score ?? 0, probabilities: a.probabilities ?? {} },
        ]),
      );
      return {
        model: result.model,
        answers: answers as Result<typeof request.questions>['answers'],
        usage: {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        },
      };
    },
  };
}
