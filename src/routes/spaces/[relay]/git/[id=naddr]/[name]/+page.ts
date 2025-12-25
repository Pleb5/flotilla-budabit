import type { PageLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageLoad = ({ params }) => {
  const { relay, id } = params as { relay: string; id: string };
  throw redirect(307, `/spaces/${relay}/git/${id}`);
};
