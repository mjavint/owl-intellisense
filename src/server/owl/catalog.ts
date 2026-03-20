import { OWLHook } from '../../shared/types';

export const OWL_HOOKS: OWLHook[] = [
  // Lifecycle hooks
  {
    name: 'onWillStart',
    signature: 'onWillStart(fn: () => Promise<void>): void',
    description:
      'Called before the component is first rendered. Useful for async initialization. The component will not render until the returned promise resolves.',
    isLifecycle: true,
    completionSnippet: 'onWillStart(async () => {\n\t$0\n})',
  },
  {
    name: 'onWillUpdateProps',
    signature: 'onWillUpdateProps(fn: (nextProps: Props) => Promise<void>): void',
    description:
      'Called before the component re-renders due to new props. Useful for async side effects triggered by prop changes.',
    isLifecycle: true,
    completionSnippet: 'onWillUpdateProps(async (nextProps) => {\n\t$0\n})',
  },
  {
    name: 'onMounted',
    signature: 'onMounted(fn: () => void): void',
    description:
      'Called after the component is first mounted in the DOM. Useful for DOM manipulation or starting subscriptions.',
    isLifecycle: true,
    completionSnippet: 'onMounted(() => {\n\t$0\n})',
  },
  {
    name: 'onWillUnmount',
    signature: 'onWillUnmount(fn: () => void): void',
    description:
      'Called just before the component is removed from the DOM. Useful for cleanup.',
    isLifecycle: true,
    completionSnippet: 'onWillUnmount(() => {\n\t$0\n})',
  },
  {
    name: 'onPatched',
    signature: 'onPatched(fn: () => void): void',
    description:
      'Called after the component is re-rendered/patched due to a state or prop change.',
    isLifecycle: true,
    completionSnippet: 'onPatched(() => {\n\t$0\n})',
  },
  {
    name: 'onWillPatch',
    signature: 'onWillPatch(fn: () => void): void',
    description:
      'Called just before the component re-renders due to a state or prop change.',
    isLifecycle: true,
    completionSnippet: 'onWillPatch(() => {\n\t$0\n})',
  },
  {
    name: 'onWillDestroy',
    signature: 'onWillDestroy(fn: () => void): void',
    description:
      'Called just before the component is destroyed. Similar to onWillUnmount but also fires when the app is destroyed.',
    isLifecycle: true,
    completionSnippet: 'onWillDestroy(() => {\n\t$0\n})',
  },
  {
    name: 'onError',
    signature: 'onError(fn: (error: Error) => void): void',
    description:
      'Called when an error is caught from a child component. Useful for error boundaries.',
    isLifecycle: true,
    completionSnippet: 'onError((error) => {\n\t$0\n})',
  },

  // Utility hooks
  {
    name: 'useState',
    signature: 'useState<T extends object>(state: T): T',
    description:
      'Returns a reactive proxy of the provided state object. Mutations to the returned object trigger re-renders.',
    returns: 'Reactive proxy (T)',
    isLifecycle: false,
    completionSnippet: 'useState($0)',
  },
  {
    name: 'useRef',
    signature: 'useRef(name: string): { el: HTMLElement | null }',
    description:
      'Returns a ref object bound to a DOM element with the matching `t-ref` attribute in the template.',
    returns: '{ el: HTMLElement | null }',
    isLifecycle: false,
    completionSnippet: 'useRef("$0")',
  },
  {
    name: 'useComponent',
    signature: 'useComponent(): Component',
    description:
      'Returns the current component instance. Useful inside custom hooks that need access to the component.',
    returns: 'Component instance',
    isLifecycle: false,
    completionSnippet: 'useComponent()',
  },
  {
    name: 'useEnv',
    signature: 'useEnv(): Env',
    description:
      'Returns the current environment object provided to the component tree.',
    returns: 'Env object',
    isLifecycle: false,
    completionSnippet: 'useEnv()',
  },
  {
    name: 'useService',
    signature: 'useService(serviceName: string): unknown',
    description:
      'Returns a service registered in the OWL environment by its name.',
    returns: 'Service instance',
    isLifecycle: false,
    completionSnippet: 'useService("$0")',
    importSource: '@web/core/utils/hooks',
  },
  {
    name: 'useStore',
    signature: 'useStore<T>(selector: (state: State) => T): T',
    description:
      'Subscribes the component to a store slice. Re-renders when the selected slice changes.',
    returns: 'Selected store slice (T)',
    isLifecycle: false,
    completionSnippet: 'useStore((state) => $0)',
  },
  {
    name: 'useEffect',
    signature: 'useEffect(fn: () => (() => void) | void, deps?: () => unknown[]): void',
    description:
      'Runs a side-effect after the component mounts and after every patch when deps change. The returned function (if any) is called for cleanup.',
    isLifecycle: false,
    completionSnippet: 'useEffect(() => {\n\t$0\n}, () => [])',
  },
  {
    name: 'useChildSubEnv',
    signature: 'useChildSubEnv(env: Partial<Env>): void',
    description:
      'Provides additional environment values only to child components, without affecting the current component or its siblings.',
    isLifecycle: false,
    completionSnippet: 'useChildSubEnv({\n\t$0\n})',
  },
  {
    name: 'useSubEnv',
    signature: 'useSubEnv(env: Partial<Env>): void',
    description:
      'Provides additional environment values to the current component and all its children.',
    isLifecycle: false,
    completionSnippet: 'useSubEnv({\n\t$0\n})',
  },
  {
    name: 'useExternalListener',
    signature: 'useExternalListener(target: EventTarget, eventName: string, handler: EventListener, options?: EventListenerOptions): void',
    description:
      'Attaches an event listener to an external target (e.g., `window`, `document`) and automatically removes it when the component is destroyed.',
    isLifecycle: false,
    completionSnippet: 'useExternalListener($1, "$2", $0)',
  },
];

export interface OWLClass {
  name: string;
  signature: string;
  description: string;
}

export const OWL_CLASSES: OWLClass[] = [
  {
    name: 'Component',
    signature: 'class Component<Props = {}, Env = {}> extends Component',
    description:
      'Base class for all OWL components. Subclass it and define a static `template` property (XML template name) plus an optional `props` schema for prop validation.',
  },
  {
    name: 'App',
    signature: 'new App(Root: typeof Component, config?: AppConfig)',
    description:
      'OWL application container. Creates and mounts the root component tree. Call `.mount(target)` to attach to a DOM element.',
  },
  {
    name: 'EventBus',
    signature: 'new EventBus()',
    description:
      'Simple pub/sub event bus. Use `.on(event, owner, callback)` to subscribe and `.trigger(event, payload)` to publish.',
  },
  {
    name: 'reactive',
    signature: 'reactive<T extends object>(state: T, callback?: () => void): T',
    description:
      'Creates a reactive proxy that calls the optional callback whenever any property is mutated. Used to build fine-grained reactivity outside of `useState`.',
  },
  {
    name: 'markup',
    signature: 'markup(value: string): MarkupType',
    description:
      'Marks a string as safe HTML so OWL renders it without escaping. Use with caution — only pass trusted content.',
  },
  {
    name: 'xml',
    signature: 'xml`<template>...</template>`',
    description:
      'Tagged template literal that registers an inline XML template and returns its name. Useful for defining templates directly in JavaScript/TypeScript files.',
  },
  {
    name: 'mount',
    signature: 'mount(Component: typeof Component, target: HTMLElement, config?: AppConfig): Promise<Component>',
    description: 'Shorthand to create an App and mount it to a DOM target in one call.',
  },
];

export const OWL_CLASS_NAMES: Set<string> = new Set(OWL_CLASSES.map((c) => c.name));

export function getClassByName(name: string): OWLClass | undefined {
  return OWL_CLASSES.find((c) => c.name === name);
}

export const HOOK_NAMES: Set<string> = new Set(OWL_HOOKS.map((h) => h.name));

// Alias for use in references provider
export const OWL_HOOK_NAMES = HOOK_NAMES;

export function getHookByName(name: string): OWLHook | undefined {
  return OWL_HOOKS.find((h) => h.name === name);
}
