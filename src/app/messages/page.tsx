import { redirect } from 'next/navigation';

// Preserve existing bookmarks and email links while retiring the legacy shell.
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const { conversation } = await searchParams;
  redirect(conversation ? `/?view=messages&conversation=${encodeURIComponent(conversation)}` : '/?view=messages');
}
