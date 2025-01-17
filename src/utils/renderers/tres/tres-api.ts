import { BufferAttribute } from 'three'
import type { Camera, Object3D } from 'three'
import { deepArrayEqual, isHTMLTag, kebabToCamel } from './utils/index'

import type { TresObject, TresObject3D, TresScene } from './types'
import { catalogue } from './catalogue'
import { Props } from '@/utils/types'
import { isFn } from '@/utils/shared'
import { DOMApi } from '@/utils/dom-api'


let scene: TresScene | null = null

const { logError } = {
  logError(msg: string) {
    console.log(msg);
  }
}

const supportedPointerEvents = [
  'onClick',
  'onPointerMove',
  'onPointerEnter',
  'onPointerLeave',
]

export class TresBrowserDOMApi implements DOMApi {
  element(tag: string, _isSVG = false, _anchor = false, _props: Props = [[],[],[]]) {
    let props = {};
    let args = _props[1];
    args.forEach((arg) => {
      // @ts-expect-error
      props[arg[0]] = arg[1];
    });
    if (!props) { props = {} }

    // @ts-expect-error
    if (!props.args) {
      // @ts-expect-error
      props.args = []
    }
    if (tag === 'template') { return null }
    if (isHTMLTag(tag)) { return null }
    let name = tag.replace('Tres', '')
    let instance

    if (tag === 'primitive') {
      // @ts-expect-error
      if (props?.object === undefined) { logError('Tres primitives need a prop \'object\'') }
      // @ts-expect-error
      const object = props.object as TresObject
      name = object.type
      // @ts-expect-error
      instance = Object.assign(object, { type: name, attach: props.attach, primitive: true })
    }
    else {
      const target = catalogue.value[name]
      if (!target) {
        logError(`${name} is not defined on the THREE namespace. Use extend to add it to the catalog.`)
      }
      // eslint-disable-next-line new-cap
      // @ts-expect-error
      instance = new target(...props.args)
    }

    if (instance.isCamera) {
      // @ts-expect-error
      if (!props?.position) {
        instance.position.set(3, 3, 3)
      }
      // @ts-expect-error
      if (!props?.lookAt) {
        instance.lookAt(0, 0, 0)
      }
    }

    // @ts-expect-error
    if (props?.attach === undefined) {
      if (instance.isMaterial) { instance.attach = 'material' }
      else if (instance.isBufferGeometry) { instance.attach = 'geometry' }
    }

    // determine whether the material was passed via prop to
    // prevent it's disposal when node is removed later in it's lifecycle

    if (instance.isObject3D) {
      // @ts-expect-error
      if (props?.material?.isMaterial) { (instance as TresObject3D).userData.tres__materialViaProp = true }
      // @ts-expect-error
      if (props?.geometry?.isBufferGeometry) { (instance as TresObject3D).userData.tres__geometryViaProp = true }
    }

    // Since THREE instances properties are not consistent, (Orbit Controls doesn't have a `type` property)
    // we take the tag name and we save it on the userData for later use in the re-instancing process.
    instance.userData = {
      ...instance.userData,
      tres__name: name,
    }

    return instance
  }
  // @ts-expect-error
  insert(parent, child) {
    if (parent && parent.isScene) { scene = parent as unknown as TresScene }
    const parentObject = parent || scene

    if (child?.isObject3D) {
      if (child?.isCamera) {
        if (!scene?.userData.tres__registerCamera) { throw new Error('could not find tres__registerCamera on scene\'s userData') }

        scene?.userData.tres__registerCamera?.(child as unknown as Camera)
      }

      if (
        child && supportedPointerEvents.some(eventName => child[eventName])
      ) {
        if (!scene?.userData.tres__registerAtPointerEventHandler) { throw new Error('could not find tres__registerAtPointerEventHandler on scene\'s userData') }

        scene?.userData.tres__registerAtPointerEventHandler?.(child as Object3D)
      }
    }

    if (child?.isObject3D && parentObject?.isObject3D) {
      parentObject.add(child)
      child.dispatchEvent({ type: 'added' })
    }
    else if (child?.isFog) {
      parentObject.fog = child
    }
    else if (typeof child?.attach === 'string') {
      child.__previousAttach = child[parentObject?.attach as string]
      if (parentObject) {
        parentObject[child.attach] = child
      }
    }
  }
  // @ts-expect-error
  destroy(node) {
    if (!node) { return }
    // remove is only called on the node being removed and not on child nodes.

    if (node.isObject3D) {
      const object3D = node as unknown as Object3D

      const disposeMaterialsAndGeometries = (object3D: Object3D) => {
        const tresObject3D = object3D as TresObject3D

        if (!object3D.userData.tres__materialViaProp) {
          tresObject3D.material?.dispose()
          tresObject3D.material = undefined
        }

        if (!object3D.userData.tres__geometryViaProp) {
          tresObject3D.geometry?.dispose()
          tresObject3D.geometry = undefined
        }
      }

      const deregisterAtPointerEventHandler = scene?.userData.tres__deregisterAtPointerEventHandler
      const deregisterBlockingObjectAtPointerEventHandler
        = scene?.userData.tres__deregisterBlockingObjectAtPointerEventHandler

      const deregisterAtPointerEventHandlerIfRequired = (object: TresObject) => {
        if (!deregisterBlockingObjectAtPointerEventHandler) { throw new Error('could not find tres__deregisterBlockingObjectAtPointerEventHandler on scene\'s userData') }

        scene?.userData.tres__deregisterBlockingObjectAtPointerEventHandler?.(object as Object3D)

        if (!deregisterAtPointerEventHandler) { throw new Error('could not find tres__deregisterAtPointerEventHandler on scene\'s userData') }

        if (
          object && supportedPointerEvents.some(eventName => object[eventName])
        ) { deregisterAtPointerEventHandler?.(object as Object3D) }
      }

      const deregisterCameraIfRequired = (object: Object3D) => {
        const deregisterCamera = scene?.userData.tres__deregisterCamera

        if (!deregisterCamera) { throw new Error('could not find tres__deregisterCamera on scene\'s userData') }

        if ((object as Camera).isCamera) { deregisterCamera?.(object as Camera) }
      }

      node.removeFromParent?.()
      object3D.traverse((child: Object3D) => {
        disposeMaterialsAndGeometries(child)
        deregisterCameraIfRequired(child)
        deregisterAtPointerEventHandlerIfRequired?.(child as TresObject)
      })

      disposeMaterialsAndGeometries(object3D)
      deregisterCameraIfRequired(object3D)
      deregisterAtPointerEventHandlerIfRequired?.(object3D as TresObject)
    }

    node.dispose?.()
  }
  // @ts-expect-error
  attr(node, prop, nextValue) {
    this.prop(node, prop, nextValue);
  }
  // @ts-expect-error
  prop(node, prop, nextValue) {
    if (node) {
      let root = node
      let key = prop
      if (node.isObject3D && key === 'blocks-pointer-events') {
        if (nextValue || nextValue === '') { scene?.userData.tres__registerBlockingObjectAtPointerEventHandler?.(node as Object3D) }
        else { scene?.userData.tres__deregisterBlockingObjectAtPointerEventHandler?.(node as Object3D) }

        return
      }

      let finalKey = kebabToCamel(key)
      let target = root?.[finalKey]

      if (key === 'args') {
        const prevNode = node as TresObject3D
        const prevArgs: any[] = [];
        const args = nextValue ?? []
        const instanceName = node.userData.tres__name || node.type

        if (instanceName && prevArgs.length && !deepArrayEqual(prevArgs, args)) {
          root = Object.assign(prevNode, new catalogue.value[instanceName](...nextValue))
        }
        return
      }

      if (root.type === 'BufferGeometry') {
        if (key === 'args') { return }
        root.setAttribute(
          kebabToCamel(key),
          new BufferAttribute(...(nextValue as ConstructorParameters<typeof BufferAttribute>)),
        )
        return
      }

      // Traverse pierced props (e.g. foo-bar=value => foo.bar = value)
      if (key.includes('-') && target === undefined) {
        const chain = key.split('-')
        // @ts-expect-error
        target = chain.reduce((acc, key) => acc[kebabToCamel(key)], root)
        key = chain.pop() as string
        finalKey = key.toLowerCase()
        // @ts-expect-error
        if (!target?.set) { root = chain.reduce((acc, key) => acc[kebabToCamel(key)], root) }
      }
      let value = nextValue
      if (value === '') { value = true }
      // Set prop, prefer atomic methods if applicable
      if (isFn(target)) {
        // don't call pointer event callback functions
        if (!supportedPointerEvents.includes(prop)) {
          if (Array.isArray(value)) { node[finalKey](...value) }
          else { node[finalKey](value) }
        }
        return
      }
      if (!target?.set && !isFn(target)) { root[finalKey] = value }
      else if (target.constructor === value.constructor && target?.copy) { target?.copy(value) }
      else if (Array.isArray(value)) { target.set(...value) }
      else if (!target.isColor && target.setScalar) { target.setScalar(value) }
      else { target.set(value) }
    }
  }
  // @ts-expect-error
  parentNode(node) {
    return node?.parent || null
  }
}