import {beforeEach, describe, expect, it, vi} from "vitest";
import {fallbackCard} from "../src/core";

beforeEach(() => {vi.resetModules();document.body.innerHTML='<main id="card"></main>';});
describe("cover visibility in saved cards", () => {
  it.each([
    {compact:true,remoteImages:true,image:"https://cdn.example.com/cover.jpg",show:true},
    {compact:true,remoteImages:false,image:"assets/cardlink-cover.jpg",show:true},
    {compact:false,remoteImages:false,image:"assets/cardlink-cover.jpg",show:true},
    {compact:true,remoteImages:false,image:"https://cdn.example.com/cover.jpg",show:false},
  ])("renders compact=$compact, remote=$remoteImages, image=$image",async ({compact,remoteImages,image,show})=>{
    const data={...fallbackCard("https://www.bilibili.com/video/BV1HvxC6bEoE"),description:"Video description",compact,remoteImages,image};
    history.replaceState(null,"",`/plugins/siyuan-auto-card-link/card.html#${encodeURIComponent(JSON.stringify(data))}`);
    await import("../src/card");
    const cover=document.querySelector<HTMLImageElement>(".cover");
    expect(Boolean(cover)).toBe(show);
    if(show)expect(cover!.getAttribute("src")).toBe(image.startsWith("assets/")?"/"+image:image);
    expect(Boolean(document.querySelector(".description"))).toBe(!compact);
  });
});
