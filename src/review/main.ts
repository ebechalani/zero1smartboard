/**
 * Entry of review.html (docs/CLASSROOM.md §4.14): the review page with the sandboxed simulator.
 * Imports only share-link.ts, sketch-file.ts and its own CSS: no Firebase, no classroom module.
 */
import '../ui/style.css';
import './review.css';
import { mountReview } from './page';

const root = document.getElementById('review');
if (root) mountReview(root, { hash: location.hash });
