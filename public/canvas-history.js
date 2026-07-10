export class CanvasHistory {
  constructor({ maxSize = 50, onChange = null } = {}) {
    this.maxSize = Math.max(1, Math.round(Number(maxSize) || 50));
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.scope = null;
    this.scopeEpoch = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.queue = Promise.resolve();
    this.pendingCount = 0;
    this.nextCommitTicketId = 1;
    this.pendingCommitTickets = [];
  }

  setScope(scope) {
    const nextScope = normalizeScope(scope);
    if (nextScope === this.scope) return false;
    this.scope = nextScope;
    this.invalidateHistory();
    this.emitChange();
    return true;
  }

  clear() {
    this.invalidateHistory();
    this.emitChange();
  }

  commit(operation) {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("Canvas history commit requires an operation function."));
    }

    const ticket = {
      id: this.nextCommitTicketId,
      scope: this.scope,
      epoch: this.scopeEpoch,
      state: "pending",
      action: null
    };
    this.nextCommitTicketId += 1;
    this.pendingCommitTickets.push(ticket);

    return this.enqueue(async () => {
      if (!this.isTicketCurrent(ticket)) {
        ticket.state = "cancelled";
        this.removePendingCommitTicket(ticket);
        return undefined;
      }

      ticket.state = "running";
      try {
        const result = await operation({ scope: ticket.scope });
        if (!this.isTicketCurrent(ticket)) {
          ticket.state = "cancelled";
          return result?.value;
        }

        const action = result?.action ? this.record(result.action, ticket.scope) : null;
        ticket.action = action;
        ticket.state = action ? "recorded" : "no-action";
        return result?.value;
      } catch (error) {
        ticket.state = this.isTicketCurrent(ticket) ? "failed" : "cancelled";
        throw error;
      } finally {
        this.removePendingCommitTicket(ticket);
      }
    });
  }

  undo(apply) {
    return this.applyFromStack("undo", apply, this.latestPendingCommitTicket());
  }

  redo(apply) {
    return this.applyFromStack("redo", apply);
  }

  get busy() {
    return this.pendingCount > 0;
  }

  get canUndo() {
    return this.undoStack.length > 0 && !this.busy;
  }

  get canRedo() {
    return this.redoStack.length > 0 && !this.busy;
  }

  get status() {
    return {
      scope: this.scope,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      busy: this.busy,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length
    };
  }

  applyFromStack(direction, apply, commitTicket = null) {
    if (typeof apply !== "function") {
      return Promise.reject(new TypeError("Canvas history apply requires a function."));
    }
    return this.enqueue(async () => {
      if (commitTicket) {
        if (commitTicket.scope !== this.scope || commitTicket.epoch !== this.scopeEpoch) return null;
        if (commitTicket.state !== "recorded" || !commitTicket.action) return null;
        if (this.undoStack.at(-1) !== commitTicket.action) return null;
      }

      const source = direction === "undo" ? this.undoStack : this.redoStack;
      const target = direction === "undo" ? this.redoStack : this.undoStack;
      const action = source.pop();
      if (!action) return null;
      if (action.scope !== this.scope) {
        this.clear();
        return null;
      }
      try {
        await apply(action, direction);
      } catch (error) {
        source.push(action);
        throw error;
      }
      target.push(action);
      this.trim(target);
      return action;
    });
  }

  record(action, scope) {
    if (!action || typeof action !== "object" || !action.type) return null;
    const storedAction = {
      ...cloneHistoryAction(action),
      scope
    };
    this.undoStack.push(storedAction);
    this.trim(this.undoStack);
    this.redoStack = [];
    return storedAction;
  }

  trim(stack) {
    if (stack.length > this.maxSize) stack.splice(0, stack.length - this.maxSize);
  }

  enqueue(operation) {
    this.pendingCount += 1;
    this.emitChange();

    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending.finally(() => {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      this.emitChange();
    });
  }

  invalidateHistory() {
    this.scopeEpoch += 1;
    this.undoStack = [];
    this.redoStack = [];
    for (const ticket of this.pendingCommitTickets) {
      if (ticket.state === "pending" || ticket.state === "running") ticket.state = "cancelled";
    }
  }

  isTicketCurrent(ticket) {
    return ticket.scope === this.scope
      && ticket.epoch === this.scopeEpoch
      && ticket.state !== "cancelled";
  }

  latestPendingCommitTicket() {
    for (let index = this.pendingCommitTickets.length - 1; index >= 0; index -= 1) {
      const ticket = this.pendingCommitTickets[index];
      if (ticket.scope !== this.scope || ticket.epoch !== this.scopeEpoch) continue;
      if (ticket.state === "pending" || ticket.state === "running") return ticket;
    }
    return null;
  }

  removePendingCommitTicket(ticket) {
    const index = this.pendingCommitTickets.indexOf(ticket);
    if (index >= 0) this.pendingCommitTickets.splice(index, 1);
  }

  emitChange() {
    if (!this.onChange) return;
    try {
      this.onChange(this.status);
    } catch {
      // History observers must never interrupt a queued canvas operation.
    }
  }
}

function normalizeScope(scope) {
  if (scope === null || scope === undefined || scope === "") return null;
  return typeof scope === "string" ? scope : JSON.stringify(scope);
}

function cloneHistoryAction(action) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(action);
  return JSON.parse(JSON.stringify(action));
}
