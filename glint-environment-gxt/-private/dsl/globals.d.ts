import { Globals as EELGlobals } from '@glint/environment-ember-loose/-private/dsl';
import Globals from '../../globals';
import { EachKeyword } from './intrinsics/each';
import { ComponentLike } from '@glint/template';
import { ModifierReturn } from '@glint/template/-private/integration';
import { InElementKeyword } from './intrinsics/in-element';

interface Keywords
  extends Pick<
    EELGlobals,
    | 'component'
    | 'debugger'
    | 'has-block'
    | 'has-block-params'
    | 'helper'
    | 'if'
    | 'let'
    | 'log'
    | 'modifier'
    | 'unless'
    | 'yield'
  > {}

// Define a mapping of event names to event types
type EventTypeMap = {
  beforeinput: InputEvent;
  input: InputEvent;
  submit: SubmitEvent;
  click: PointerEvent;
  gotpointercapture: PointerEvent;
  lostpointercapture: PointerEvent;
  dblclick: MouseEvent;
  mouseup: MouseEvent;
  mousedown: MouseEvent;
  mouseenter: MouseEvent;
  mouseleave: MouseEvent;
  mouseout: MouseEvent;
  mouseover: MouseEvent;
  mousemove: MouseEvent;
  keyup: KeyboardEvent;
  keydown: KeyboardEvent;
  animationcancel: AnimationEvent;
  animationend: AnimationEvent;
  animationiteration: AnimationEvent;
  animationstart: AnimationEvent;
  auxclick: PointerEvent;
  contextmenu: PointerEvent;
  pointercancel: PointerEvent;
  pointerdown: PointerEvent;
  pointerenter: PointerEvent;
  pointerleave: PointerEvent;
  pointermove: PointerEvent;
  pointerout: PointerEvent;
  pointerover: PointerEvent;
  pointerup: PointerEvent;
  blur: FocusEvent;
  focus: FocusEvent;
  focusin: FocusEvent;
  focusout: FocusEvent;
  compositionend: CompositionEvent;
  compositionstart: CompositionEvent;
  compositionupdate: CompositionEvent;
  // @ts-ignore unused directive
  // @ts-expect-error unknown event type
  contentvisibilityautostatechange: ContentVisibilityAutoStateChangeEvent;
  copy: ClipboardEvent;
  cut: ClipboardEvent;
  paste: ClipboardEvent;
  fullscreenchange: Event;
  fullscreenchangeerror: Event;
  scroll: Event;
  scrollend: Event;
  securitypolicyviolation: SecurityPolicyViolationEvent;
  touchcancel: TouchEvent;
  touchend: TouchEvent;
  touchmove: TouchEvent;
  touchstart: TouchEvent;
  transitioncancel: TransitionEvent;
  transitionend: TransitionEvent;
  transitionrun: TransitionEvent;
  transitionstart: TransitionEvent;
  wheel: WheelEvent;
  // Add other mappings as needed
  // Default case for other mouse events
  [key: string]: Event;
};

type ResolveEventType<T extends string> =
  T extends keyof EventTypeMap ? EventTypeMap[T] :Event;

type EventKeys<T> = Extract<keyof T, `on${string}`>;
type RemoveOnPrefix<T> = T extends `on${infer U}` ? U : never;
type EventsFromNode<T> = RemoveOnPrefix<EventKeys<T>>;

// Generic event handler function type
interface EventHandler {
  <Y extends Element, T extends EventsFromNode<Y>>(
    element: Y,
    event: T,
    callback: (e: ResolveEventType<T>, element: Y) => void
  ): ModifierReturn;
}

interface Internal {
  each: EachKeyword;
  'in-element': InElementKeyword;
  on: EventHandler;
  array: <T extends unknown>(...params: T[]) => T[];
  hash: <T extends Record<string, unknown>>(obj: T) => T;
  fn: (...args: any) => (...args: any) => void;
  eq: (...args: any) => boolean;
  or: (...args: any) => any;
  not: (value: any) => boolean;
  and: (...args: any) => boolean;
  element: (tagName: string) => ComponentLike<{
    Element: Element;
    Blocks: {
      default: [];
    };
  }>;
}

export const Globals: Keywords & Globals & Internal;
