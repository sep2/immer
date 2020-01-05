import {
	each,
	has,
	is,
	isDraft,
	isDraftable,
	isEnumerable,
	isMap,
	isSet,
	hasSymbol,
	shallowCopy,
	DRAFT_STATE,
	iterateMapValues,
	makeIterable,
	makeIterateSetValues,
	latest
} from "./common"

// TODO: kill:
import {
	assertUnrevoked,
	ES5Draft,
} from "./es5"
import { ImmerScope } from "./scope";
import { Immer } from "./immer";

// TODO: create own states
// TODO: clean up the maps and such from ES5 / Proxy states

export interface MapState {
	parent: any; // TODO: type
	scope: ImmerScope;
	modified: boolean;
	finalizing: boolean;
	finalized: boolean;
	copy: Map<any, any> | undefined;
	assigned: Map<any, boolean> | undefined;
	base: Map<any, any>;
	revoke(): void;
	draft: ES5Draft;
}

function prepareCopy(state: MapState) {
	if (!state.copy) {
		state.assigned = new Map()
		state.copy = new Map(state.base);
	}
}

// Make sure DraftMap declarion doesn't die if Map is not avialable...
const MapBase: MapConstructor = typeof Map !== "undefined" ? Map : function FakeMap() {} as any

// TODO: fix types for drafts
export class DraftMap<K, V> extends MapBase implements Map<K, V> {
	[DRAFT_STATE]: MapState
	constructor(target, parent) {
		super()
		this[DRAFT_STATE] = {
			parent,
			scope: parent ? parent.scope : ImmerScope.current,
			modified: false,
			finalized: false,
			finalizing: false,
			copy: undefined,
			assigned: undefined,
			base: target,
			draft: this as any, // TODO: fix typing
			revoke() {
				// TODO: make sure this marks the Map as revoked, and assert everywhere
			}
		};
	}

	get size(): number {
		return latest(this[DRAFT_STATE]).size
	}

	has(key: K): boolean {
		return latest(this[DRAFT_STATE]).has(key)
	}

	set(key: K, value: V): this {
		const state = this[DRAFT_STATE];
		if (latest(state).get(key) !== value) {
			prepareCopy(state)
			state.scope.immer.markChanged(state) // TODO: this needs to bubble up recursively correctly
			state.assigned!.set(key, true)
			state.copy!.set(key, value)
			state.assigned!.set(key, true);
		}
		return this
	}

	delete(key: K): boolean {
		if (!this.has(key)) {
			return false;
		}

		const state = this[DRAFT_STATE];
		prepareCopy(state)
		state.scope.immer.markChanged(state)
		state.assigned!.set(key, false)
		state.copy!.delete(key)
		return true
	}

	clear() {
		const state = this[DRAFT_STATE];
		prepareCopy(state)
		state.scope.immer.markChanged(state)
		state.assigned = new Map()
		for (const key of latest(state).keys()) {
			state.assigned.set(key, false)
		}
		return state.copy!.clear()
	}

	// @ts-ignore TODO:
	forEach(cb) {
		const state = this[DRAFT_STATE];
		latest(state).forEach((_value, key, _map) => {
			cb(this.get(key), key, this)
		})
	}

	get(key: K): V /* TODO: Draft<V> */  {
		const state = this[DRAFT_STATE];
		const value = latest(state).get(key)
		if (state.finalizing || state.finalized || !isDraftable(value)) {
			return value
		}
		if (value !== state.base.get(key)) {
			return value // either already drafted or reassigned
		}
		const draft = state.scope.immer.createProxy(value, state)
		prepareCopy(state)
		state.copy!.set(key, draft)
		return draft
	}

	keys() {
		return latest(this[DRAFT_STATE]).keys();
	}

	// TODO: make these normal functions
	// TODO: values and entries iterators
	// @ts-ignore TODO:
	values = iterateMapValues
	// @ts-ignore TODO:
	entries = iterateMapValues
}


if (hasSymbol) {
	Object.defineProperty(
		DraftMap.prototype,
		Symbol.iterator,
		// @ts-ignore TODO fix
		proxyMethod(iterateMapValues)
	)
}

export function proxyMap(target, parent) {
	if (target instanceof DraftMap) {
		return target; // TODO: or copy?
	}
	return new DraftMap(target, parent)
	// Object.defineProperties(target, mapTraps)

}

// TODO: kill?
function proxyMethod(trap, key) {
	return {
		get() {
			return function(this: ES5Draft, ...args) {
				const state = this[DRAFT_STATE]
				assertUnrevoked(state)
				return trap(state, key, state.draft)(...args)
			}
		}
	}
}

// TODO: used?
export function hasMapChanges(state) {
	const {base, draft} = state

	if (base.size !== draft.size) return true

	// IE11 supports only forEach iteration
	let hasChanges = false
	// TODO: optimize: break on first difference
	draft.forEach(function(value, key) {
		if (!hasChanges) {
			hasChanges = isDraftable(value) ? value.modified : value !== base.get(key)
		}
	})
	return hasChanges
}