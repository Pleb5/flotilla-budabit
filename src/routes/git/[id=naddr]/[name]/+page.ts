import type {PageLoad} from "./$types"
import {redirect} from "@sveltejs/kit"

export const load: PageLoad = ({params}) => {
  const {id} = params as {id: string}
  throw redirect(307, `/git/${id}`)
}
