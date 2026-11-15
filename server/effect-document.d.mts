import type { Keyframe } from './keyframes.mjs'
export type ClipEffect = {id:string;enabled:boolean;amount:number;detail:number;start:number;end:number;keys?:Keyframe[]}
export type ClipTransition = {id:string;direction:string;amount:number;start:number;length:number}
export const effects: [string,string,string,string][]
export const transitions: [string,string,string][]
export const directions: string[]
export const maxEffects: number
export function effectDocument(stack: unknown,length:number): ClipEffect[] | undefined
export function transitionDocument(value: unknown,length:number,fps:number): ClipTransition | undefined
export function sliceEffects(stack:ClipEffect[]|undefined,offset:number,length:number): ClipEffect[]|undefined
export type EffectsLibrary = {names:Record<string,string>;favorites:string[]}
export function libraryDocument(input:unknown): EffectsLibrary
