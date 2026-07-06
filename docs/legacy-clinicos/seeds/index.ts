/**
 * buildSeedState — ensambla el estado semilla de TODAS las clínicas demo.
 *
 * Cada seed muta el MockState compartido sin tocar a las demás clínicas.
 * La sesión arranca en `null`: la app abre en la pantalla de login y
 * `auth.loginAs` la fija. La persistencia en localStorage (MockDb) restaura
 * la sesión entre recargas.
 */
import { emptyState, type MockState } from "../state";
import { seedMoreno } from "./moreno";
import { seedOranza } from "./oranza";
import { seedAndrei } from "./andrei";
import { seedDevia } from "./devia";

export function buildSeedState(): MockState {
  const state = emptyState();
  seedMoreno(state);
  seedOranza(state);
  seedAndrei(state);
  seedDevia(state);
  return state;
}
