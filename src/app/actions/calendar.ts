"use server";
// Server wrappers - the logic lives in src/lib/actions/calendar.ts.
import * as impl from "@/lib/actions/calendar";

export type { ActionResult, EventInput, TaskInput } from "@/lib/actions/calendar";

export async function createEvent(...args: Parameters<typeof impl.createEvent>): ReturnType<typeof impl.createEvent> {
  return impl.createEvent(...args);
}

export async function updateEvent(...args: Parameters<typeof impl.updateEvent>): ReturnType<typeof impl.updateEvent> {
  return impl.updateEvent(...args);
}

export async function deleteEvent(...args: Parameters<typeof impl.deleteEvent>): ReturnType<typeof impl.deleteEvent> {
  return impl.deleteEvent(...args);
}

export async function createTask(...args: Parameters<typeof impl.createTask>): ReturnType<typeof impl.createTask> {
  return impl.createTask(...args);
}

export async function updateTask(...args: Parameters<typeof impl.updateTask>): ReturnType<typeof impl.updateTask> {
  return impl.updateTask(...args);
}

export async function setTaskCompleted(...args: Parameters<typeof impl.setTaskCompleted>): ReturnType<typeof impl.setTaskCompleted> {
  return impl.setTaskCompleted(...args);
}

export async function deleteTask(...args: Parameters<typeof impl.deleteTask>): ReturnType<typeof impl.deleteTask> {
  return impl.deleteTask(...args);
}
