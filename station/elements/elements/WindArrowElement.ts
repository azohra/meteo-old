/* <meteo-wind-arrow>: the inline dart, standalone — decorative, so callers
 * print the FROM bearing in text beside it, exactly like the react
 * WindArrow. */
import { numberAttribute } from "../lib/attributes.js";
import { MeteoElement } from "../lib/base.js";
import { windArrowSvg } from "../lib/fragments.js";

export class WindArrowElement extends MeteoElement {
  static readonly observedAttributes = ["deg", "size"];

  protected override render(): void {
    const deg = numberAttribute(this.getAttribute("deg")) ?? 0;
    const size = numberAttribute(this.getAttribute("size")) ?? 12;
    this.replaceChildren(windArrowSvg(deg, size));
  }
}
