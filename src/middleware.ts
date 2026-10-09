import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/recuperar', '/restablecer', '/invitacion', '/setup', '/privacidad', '/pago'];

// Primera barrera: sin cookie de sesión no se entra a ninguna pantalla de la app.
// La validación real (firma, vigencia, inactividad, rol) ocurre en el layout y en cada ruta de la API.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();
  if (!req.cookies.get('nce_session')?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icons|logo|manifest.webmanifest|.*\\.png$|.*\\.svg$).*)'] };
