// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ETABSExportPanel } from '../components/argon/ETABSExportPanel';
import { createBuilding } from '@ai-floor-planner/core';

let host: HTMLDivElement, root: Root;
const building=createBuilding({projectId:'export-ui',name:'Test architecture',site:{plotWidth:18000,plotDepth:25000}});
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.stubGlobal('fetch',vi.fn());
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('exposes the native EDB control but requires separate reviewed input and a private token',async()=>{
  await act(async()=>root.render(<ETABSExportPanel building={building}/>));
  expect(host.textContent).toContain('Export to ETABS (.edb)');
  expect(host.textContent).toContain('does not run analysis');
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(host.querySelector('input[type=password]')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('drops imported structural input when the architectural revision changes',async()=>{
  await act(async()=>root.render(<ETABSExportPanel building={building}/>));
  const input=host.querySelector('input[type=file]')!;
  Object.defineProperty(input,'files',{value:[{size:2,text:async()=>'{}'}]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  await act(async()=>root.render(<ETABSExportPanel building={{...building,version:building.version+1}}/>));
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
