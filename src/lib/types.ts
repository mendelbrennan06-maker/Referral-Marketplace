export type ActionState = { error?: string; success?: string };
export type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;
