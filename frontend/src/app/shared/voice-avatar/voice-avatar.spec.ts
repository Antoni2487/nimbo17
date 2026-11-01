import { TestBed } from '@angular/core/testing';

import { VoiceAvatar } from './voice-avatar';

describe('VoiceAvatar', () => {
  beforeEach(() => {
    // jsdom no implementa getBBox/rAF de SVG: el loop no corre en estos tests.
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  });

  it('has two eyes and emits tapped when touched', async () => {
    const fixture = TestBed.createComponent(VoiceAvatar);
    const host: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    expect(host.querySelectorAll('.eye').length).toBe(2);

    const tapped = vi.fn();
    fixture.componentInstance.tapped.subscribe(tapped);
    host.click();
    expect(tapped).toHaveBeenCalledOnce();
  });

  it('shows the state, and sleeps while paused', async () => {
    const fixture = TestBed.createComponent(VoiceAvatar);
    fixture.componentRef.setInput('state', 'listening');
    fixture.componentRef.setInput('sleeping', true);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.classList).toContain('state-listening');
    expect(host.classList).toContain('sleeping');
    expect(host.getAttribute('aria-label')).toContain('en pausa');
  });
});
