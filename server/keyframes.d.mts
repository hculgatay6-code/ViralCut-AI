export type Parameter = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume' | 'reveal'
export type Curve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | 'bezier'
export type Bezier = [number, number, number, number]
export type Keyframe = { frame: number; value: number; curve: Curve; bezier?: Bezier }
export type Animation = Partial<Record<Parameter, Keyframe[]>>
export const keyframeBounds: Readonly<Record<Parameter, [number, number]>>
export const parametersByKind: Readonly<Record<'video' | 'audio' | 'caption' | 'text', Parameter[]>>
export const keyframeLimits: Readonly<{ channel: number; project: number }>
export const curves: Curve[]
export const bezierPresets: Record<'ease-in' | 'ease-out' | 'ease-in-out', Bezier>
export function keyframeDocument(animation: unknown, kind: string, length: number): Animation | undefined
export function curveValue(progress: number, curve: Curve, bezier?: Bezier): number
export function keyframeValue(points: Keyframe[] | undefined, frame: number, fallback: number): number
export function sliceAnimation(animation: Animation | undefined, offset: number, length: number): Animation | undefined
export function joinAnimation(left: Animation | undefined, right: Animation | undefined, length: number): Animation | undefined | null
