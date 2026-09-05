import type { Event } from "@prisma/client";

export function availableSeats(event: Pick<Event, "capacity">, activeRegistrations: number): number {
  return Math.max(event.capacity - activeRegistrations, 0);
}

export function serializePublicEvent(
  event: Pick<Event, "publicId" | "name" | "date" | "location" | "capacity">,
  activeRegistrations: number,
) {
  const available = availableSeats(event, activeRegistrations);

  return {
    publicId: event.publicId,
    name: event.name,
    date: event.date,
    location: event.location,
    capacity: event.capacity,
    availableSeats: available,
    isFull: available === 0,
  };
}
