import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/image',()=>({default:({src,alt,onError}:{src:string;alt:string;onError?:()=>void})=>{
 // eslint-disable-next-line @next/next/no-img-element -- Test stand-in for next/image's public DOM contract.
 return <img src={src} alt={alt} onError={onError}/>;
}}));
vi.mock('@/lib/images',()=>({productImageUrl:(id?:string)=>id?'/synthetic-image.jpg':null,productImageSources:()=>null,categoryPlaceholderSrc:()=>'/synthetic-placeholder.svg'}));
import {ProductImage} from './product-image';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('replaces a failed public image with its category placeholder through client state',()=>{
 const diagnostic=vi.spyOn(console,'warn').mockImplementation(()=>{});
 render(<ProductImage image={{cloudinaryId:'synthetic-public-image',alt:'Synthetic photo',blurDataUrl:null}} alt="Synthetic product" categorySlug="electronica"/>);
 const image=screen.getByRole('img',{name:'Synthetic photo'});expect(image).toHaveAttribute('src','/synthetic-image.jpg');
 fireEvent.error(image);
 expect(screen.queryByRole('img',{name:'Synthetic photo'})).toBeNull();
 expect(screen.getByRole('img')).toHaveAttribute('src','/synthetic-placeholder.svg');
 expect(diagnostic).toHaveBeenCalledWith('[catalog-image] load failed; showing category placeholder');
 expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('synthetic-public-image');
});
