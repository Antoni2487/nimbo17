import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // loadComponent = lazy loading: el código de la pantalla se descarga solo al entrar.
    loadComponent: () =>
      import('./features/practice/practice-page').then((m) => m.PracticePage),
  },
  { path: '**', redirectTo: '' },
];
