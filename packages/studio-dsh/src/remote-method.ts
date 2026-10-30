/** The public SDK marker, without requiring runtime decorator syntax. */
import { Remote } from '@deepseek-ai/dsh-typert-protocol'

export function markStudioRemote<This extends object, Args extends unknown[], Result>(
  prototype: This,
  name: string,
  method: (this: This, ...args: Args) => Result,
): void {
  Remote(method, {
    kind: 'method', name, static: false, private: false,
    addInitializer(initializer: (this: This) => void): void {
      initializer.call(Object.create(prototype) as This)
    },
  } as unknown as ClassMethodDecoratorContext<This, typeof method>)
}
