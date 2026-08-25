import {sequence} from '@sveltejs/kit/hooks';
import {type Handle} from '#lib/types.js';
import {SessionMiddleware} from "#lib/session.js";

export const handle: Handle = sequence(SessionMiddleware({cookie: 'session', expireIn: 300}));
