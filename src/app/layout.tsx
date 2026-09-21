import {
  Form,
  Link,
  NavLink,
  Outlet,
  ScrollRestoration,
  useNavigate,
  useParams,
  useRevalidator,
  useRouteLoaderData,
  useSearchParams,
} from 'react-router-dom'
import { Search } from 'lucide-react'
import { authClient } from '~/lib/auth-client'
import { ThemeToggle } from '~/components/theme-toggle'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from './routes'

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn('text-sm', isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')

export function Layout() {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = data?.session ?? null
  const { show } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const revalidator = useRevalidator()

  async function signOut() {
    await authClient.signOut()
    navigate('/', { replace: true })
    revalidator.revalidate()
  }

  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-5 px-6 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            alt.tv.rewind
          </Link>
          {show && (
            <>
              <span className="text-muted-foreground text-sm" aria-hidden>
                /
              </span>
              <NavLink to={`/${show}`} end className={navLink}>
                {show}
              </NavLink>
              <NavLink to={`/${show}/people`} className={navLink}>
                People
              </NavLink>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            {show && (
              <Form
                method="get"
                action={`/${show}/search`}
                className="relative hidden sm:block"
                role="search">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                  aria-hidden
                />
                <input
                  type="search"
                  name="q"
                  key={searchParams.get('q') ?? ''}
                  defaultValue={searchParams.get('q') ?? ''}
                  placeholder="Search the newsgroup"
                  aria-label="Search the newsgroup"
                  className="border-input bg-card focus-visible:ring-ring/50 h-8 w-56 rounded-md border pr-3 pl-8 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                />
              </Form>
            )}
            {session && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-sm hover:underline"
                onClick={signOut}>
                Sign out
              </button>
            )}
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto max-w-5xl px-6 py-6 text-xs leading-relaxed">
          Newsgroup archives from the Internet Archive's usenet-alt collection · episode data
          from TVMaze · posters are shown by display name only, never by address.
        </div>
      </footer>
      <ScrollRestoration />
    </>
  )
}
