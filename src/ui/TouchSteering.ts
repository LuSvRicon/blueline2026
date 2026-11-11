import { DriveControls } from './DriveControls.ts';
import type { Telemetry } from '../sim/Simulation.ts';

/** Relative thumb steering. Shares the existing smoothed input path and leaves
 *  the accelerator/brake fingers independent. No device-orientation permission. */
export class TouchSteering {
  private pad: HTMLButtonElement;
  private pointer: number | null = null;
  private origin = 0;
  private travel = 1;
  private revision = 0;
  private mode: 'buttons' | 'drag' = 'buttons';

  constructor(private root: HTMLElement, private controls: DriveControls) {
    root.querySelector('.mobile-steering')!.insertAdjacentHTML('afterbegin', `
      <div class="touch-steering-widget">
        <div class="touch-steering-options" role="group" aria-label="Cách đánh lái cảm ứng">
          <span>ĐÁNH LÁI</span><button type="button" data-steering-mode="buttons" aria-pressed="true">Nút</button><button type="button" data-steering-mode="drag" aria-pressed="false">Kéo</button>
        </div>
        <button type="button" id="touch-steering-pad" class="touch-steering-pad" aria-label="Giữ và kéo ngang để đánh lái; thả để trả lái">
          <span class="touch-steering-track" aria-hidden="true"></span>
          <svg class="touch-steering-wheel" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="25"/><path d="M8 25h48M32 40v16M12 27l14 10h12l14-10"/><circle cx="32" cy="32" r="8"/><path class="wheel-center-mark" d="M29 7h6"/></svg>
          <span class="touch-steering-hint">◀ KÉO ĐỂ LÁI ▶</span>
        </button>
      </div>`);
    this.pad = document.getElementById('touch-steering-pad') as HTMLButtonElement;
    try { this.mode = localStorage.getItem('blueline.touch-steering') === 'drag' ? 'drag' : 'buttons'; } catch { /* In-memory preference remains usable. */ }
    this.setMode(this.mode, false);
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-steering-mode]')) {
      button.addEventListener('click', () => this.setMode(button.dataset.steeringMode as typeof this.mode));
    }
    this.pad.addEventListener('pointerdown', event => {
      if (!this.controls.canDrive || this.mode !== 'drag' || this.pointer !== null || event.button !== 0) return;
      event.preventDefault();
      this.pad.focus({ preventScroll: true });
      this.revision = this.controls.revision;
      this.pointer = event.pointerId;
      this.origin = event.clientX;
      this.travel = Math.max(24, this.pad.getBoundingClientRect().width * .38);
      this.pad.setPointerCapture(event.pointerId);
      this.pad.classList.add('held');
      this.controls.setSteering(0);
    });
    this.pad.addEventListener('pointermove', event => {
      if (!this.owns(event)) return;
      event.preventDefault();
      this.controls.setSteering(Math.max(-1, Math.min(1, (event.clientX - this.origin) / this.travel)));
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.pad.addEventListener(event, e => { if (this.owns(e)) { this.reset(); this.controls.setSteering(0); } });
    }
  }

  update(t: Telemetry): void {
    this.pad.disabled = !this.controls.canDrive;
    if (!this.controls.canDrive && this.pointer !== null) this.controls.clear();
    if (!this.controls.canDrive || this.revision !== this.controls.revision) this.reset();
    this.pad.style.setProperty('--touch-wheel-angle', `${t.steer * 180 / Math.PI * 4}deg`);
  }

  private owns(event: PointerEvent): boolean {
    if (!this.controls.canDrive && this.pointer !== null) this.controls.clear();
    if (this.revision !== this.controls.revision || !this.controls.canDrive) { this.reset(); return false; }
    return this.pointer === event.pointerId;
  }
  private reset(): void {
    const pointer = this.pointer;
    this.pointer = null;
    this.pad.classList.remove('held');
    if (pointer !== null && this.pad.hasPointerCapture(pointer)) this.pad.releasePointerCapture(pointer);
    this.revision = this.controls.revision;
  }
  private setMode(mode: typeof this.mode, release = true): void {
    this.mode = mode;
    if (release) { this.controls.clear(); this.reset(); }
    this.root.dataset.steeringInput = mode;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-steering-mode]')) button.setAttribute('aria-pressed', String(button.dataset.steeringMode === mode));
    try { localStorage.setItem('blueline.touch-steering', mode); } catch { /* Optional preference. */ }
  }
}
