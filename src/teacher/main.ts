/**
 * Entry of teacher.html (docs/CLASSROOM.md §4.13): the simulator's stylesheet plus the dashboard
 * styles, then the dashboard. The TeacherApi (and with it the Firebase SDK) is loaded at page
 * load when the platform is configured, never on a click, so Sign in can open its popup at once.
 */
import '../ui/style.css';
import './teacher.css';
import { isClassroomConfigured } from '../classroom/firebase';
import { mountDashboard } from './dashboard';

const root = document.getElementById('teacher');
if (root) {
  mountDashboard(root, {
    configured: isClassroomConfigured(),
    loadApi: () => import('../classroom/teacher').then((m) => m.createTeacherApi()),
  });
}
