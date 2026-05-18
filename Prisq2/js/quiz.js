// Switches the quiz between beta-probability scoring and quantized point scoring.
const PRIMARY_MODEL = "quantized"; // Change to "beta"for logistic regression|"quantized" for scoring

// Cached DOM references used throughout the quiz flow.
const questionTextElement = document.getElementById("question-text");
const optionsContainer = document.getElementById("options-container");
const questionTracker = document.getElementById("question-tracker");
const progressBar = document.getElementById("progress-bar");
const quizWrapper = document.getElementById("quiz-wrapper");
const resultWrapper = document.getElementById("result-wrapper");
const finalScoreLabelElement = document.getElementById("final-score-label");
const riskRangesElement = document.getElementById("risk-ranges");
const restartButton = document.getElementById("restart-button");
const previousButtonElement = document.getElementById("previous-button");
const riskLevelTextElement = document.getElementById("risk-level-text");
const riskAdviceElement = document.getElementById("risk-advice");
const resultEncouragementElement = document.getElementById("result-encouragement");
const bmiSummaryElement = document.getElementById("bmi-summary");
const betaAverageFallbackScoreTypes = new Set([
    "beta_systolic",
    "beta_diastolic"
]);

// Runtime state for the current quiz session.
let quizSourceData = null;
let quizData = null;
let scoreConfig = null;
let currentQuestionId = null;
let answers = {};
let answerHistory = [];
let quizReadyNotified = false;

const fallbackQuizUiText = {
    en: {
        loadError: "Unable to load the quiz."
    },
    ar: {
        loadError: "تعذر تحميل الاختبار."
    }
};

// Wires up quiz startup and the result-screen controls.
document.addEventListener("DOMContentLoaded", initQuiz);
restartButton.addEventListener("click", restartQuiz);
previousButtonElement.addEventListener("click", goToPreviousQuestion);

// These helpers read translated quiz text from the shared data file.
function getCurrentLanguage() {
    return window.PrisqSite?.getCurrentLanguage?.() === "ar" ? "ar" : "en";
}

function getText(key) {
    const language = getCurrentLanguage();
    const uiText = quizSourceData?.quizUiText || fallbackQuizUiText;
    return uiText[language]?.[key] || uiText.en?.[key] || "";
}

function getLocalizedValue(value, language) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value[language] || value.en || value.ar || "";
    }
    return value;
}

function buildQuizData(sourceData, language) {
    return {
        title: getLocalizedValue(sourceData.qa.quizTitle, language),
        startQuestionId: sourceData.qa.startQuestionId,
        questions: sourceData.qa.questions.map((question) => {
            const questionHelpText = getLocalizedValue(question.helpText, language);
            const betaHelpText = getLocalizedValue(question.betaInput?.helpText, language);

            return {
                ...question,
                question: getLocalizedValue(question.question, language),
                helpText: questionHelpText || betaHelpText,
                measurementGuide: getLocalizedValue(question.measurementGuide, language),
                placeholder: getLocalizedValue(question.placeholder, language),
                unit: getLocalizedValue(question.unit, language),
                options: question.options?.map((option) => ({
                    ...option,
                    text: getLocalizedValue(option.text, language)
                })),
                betaInput: question.betaInput ? {
                    ...question.betaInput,
                    unit: getLocalizedValue(question.betaInput.unit, language),
                    placeholder: getLocalizedValue(question.betaInput.placeholder, language),
                    helpText: betaHelpText || questionHelpText
                } : undefined
            };
        })
    };
}

// Loads the quiz data, prepares the first state, and renders the opening question.
async function initQuiz() {
    try {
        quizSourceData = window.PrisqSite?.loadData
            ? await window.PrisqSite.loadData()
            : await fetch("data/quiz_data.json").then((response) => response.json());
        quizData = buildQuizData(quizSourceData, getCurrentLanguage());
        scoreConfig = quizSourceData.score;
        resetQuiz();
        loadQuestion();
        notifyQuizReady();
    } catch (error) {
        console.error("Failed to load quiz:", error);
        questionTextElement.textContent = getText("loadError");
        window.PrisqSite?.signalPageReady?.({ immediate: true });
    }
}

// Tells the shared site shell that the quiz content is ready to be shown.
function notifyQuizReady() {
    if (quizReadyNotified) {
        return;
    }

    quizReadyNotified = true;
    window.PrisqSite?.signalPageReady?.();
}

// Resets the quiz back to its starting state without reloading the page.
function resetQuiz() {
    currentQuestionId = quizData.startQuestionId;
    answers = {};
    answerHistory = [];
    quizWrapper.classList.remove("d-none");
    resultWrapper.classList.add("d-none");
}

function restartQuiz() {
    resetQuiz();
    loadQuestion();
}

// Chooses the current question and renders the correct input style for it.
function loadQuestion() {
    cleanupMeasurementPopovers();

    const question = quizData.questions.find(q => q.id === currentQuestionId);
    
    if (!question) {
        showResults();
        return;
    }

    const renderQuestion = getRenderedQuestion(question);

    questionTextElement.textContent = renderQuestion.question;
    
    const currentStep = answerHistory.length + 1;
    const totalQuestions = getTotalQuestionCount();
    questionTracker.textContent = `${getText("questionLabel")} ${currentStep}/${totalQuestions}`;
    
    const progressValue = (answerHistory.length / totalQuestions) * 100;
    progressBar.style.width = `${progressValue}%`;
    
    optionsContainer.innerHTML = "";
    updatePreviousButton();

    if (renderQuestion.inputType === "number_select") {
        renderNumberSelect(renderQuestion);
    } else if (renderQuestion.inputType === "number_input") {
        renderNumberInput(renderQuestion);
    } else {
        renderOptions(renderQuestion);
    }
}

// In beta mode, questions with betaInput are rendered as direct numeric inputs/selects.
function getRenderedQuestion(question) {
    if (PRIMARY_MODEL !== "beta" || !question.betaInput) {
        return question;
    }

    return {
        ...question,
        ...question.betaInput,
        inputType: "number_select"
    };
}

// Keeps partially entered answers when the user changes language mid-question.
function captureDraftAnswer() {
    const select = optionsContainer.querySelector("select");
    const input = optionsContainer.querySelector("input");
    const draftAnswer = {
        selectValue: select?.value || "",
        inputValue: input?.value || ""
    };

    return draftAnswer.selectValue || draftAnswer.inputValue ? draftAnswer : null;
}

function restoreDraftAnswer(draftAnswer) {
    if (!draftAnswer) {
        return;
    }

    const select = optionsContainer.querySelector("select");
    const input = optionsContainer.querySelector("input");

    if (select && draftAnswer.selectValue) {
        select.value = draftAnswer.selectValue;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (input && draftAnswer.inputValue) {
        input.value = draftAnswer.inputValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const errorText = optionsContainer.querySelector(".field-error");
    errorText?.classList.add("d-none");
}

function refreshQuizLanguage() {
    if (!quizSourceData) {
        return;
    }

    const draftAnswer = captureDraftAnswer();
    quizData = buildQuizData(quizSourceData, getCurrentLanguage());

    if (resultWrapper.classList.contains("d-none")) {
        loadQuestion();
        restoreDraftAnswer(draftAnswer);
        return;
    }

    showResults();
}

// These helpers build the optional "How to measure?" popover for numeric questions.
function getMeasurementGuide(question) {
    return question?.measurementGuide || null;
}

function buildMeasurementPopoverContent(measurementGuide) {
    const content = document.createElement("div");
    content.className = "measurement-popover-content";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "measurement-popover-close";
    closeButton.setAttribute("aria-label", getText("closePopover"));
    closeButton.innerHTML = "&times;";

    const bodyText = document.createElement("p");
    bodyText.className = "measurement-popover-text";
    bodyText.textContent = measurementGuide;

    content.appendChild(closeButton);
    content.appendChild(bodyText);

    return content;
}

function appendFieldGuidance(container, question) {
    if (question.helpText) {
        const hint = document.createElement("p");
        hint.className = "field-hint";
        hint.textContent = question.helpText;
        container.appendChild(hint);
    }

    const measurementGuide = getMeasurementGuide(question);

    if (!measurementGuide) {
        return;
    }

    const guideWrapper = document.createElement("div");
    guideWrapper.className = "measurement-guide";

    const guideButton = document.createElement("button");
    guideButton.type = "button";
    guideButton.className = "measurement-guide-btn";
    guideButton.textContent = getText("measureGuideCta");
    guideButton.setAttribute("aria-label", getText("measureGuideCta"));
    guideWrapper.appendChild(guideButton);
    container.appendChild(guideWrapper);

    if (window.bootstrap?.Popover) {
        new window.bootstrap.Popover(guideButton, {
            content: () => buildMeasurementPopoverContent(measurementGuide),
            html: true,
            placement: "bottom",
            trigger: "hover focus click",
            customClass: "measurement-popover",
            container: "body",
            sanitize: false
        });
        return;
    }

    guideButton.title = measurementGuide;
}

function closeMeasurementPopover(triggerButton, options = {}) {
    if (!(triggerButton instanceof HTMLElement)) {
        return;
    }

    const popoverInstance = window.bootstrap?.Popover
        ? window.bootstrap.Popover.getInstance(triggerButton)
        : null;

    if (!popoverInstance) {
        return;
    }

    const { restoreFocus = false } = options;
    const finishClose = () => {
        if (restoreFocus) {
            triggerButton.focus({ preventScroll: true });
        } else {
            triggerButton.blur();
        }

        window.setTimeout(() => {
            popoverInstance.enable();
        }, 0);
    };

    popoverInstance.disable();
    triggerButton.addEventListener("hidden.bs.popover", finishClose, { once: true });
    popoverInstance.hide();

    if (!triggerButton.getAttribute("aria-describedby")) {
        triggerButton.removeEventListener("hidden.bs.popover", finishClose);
        finishClose();
    }
}

// Closes and disposes old popovers before the next question is rendered.
function cleanupMeasurementPopovers() {
    if (window.bootstrap?.Popover) {
        document.querySelectorAll(".measurement-guide-btn").forEach((button) => {
            window.bootstrap.Popover.getInstance(button)?.dispose();
        });
    }

    document.querySelectorAll(".measurement-popover.popover").forEach((popoverElement) => {
        popoverElement.remove();
    });
}

// Closes the custom measurement popover when the inline close button is clicked.
document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const closeButton = target?.closest(".measurement-popover-close");

    if (!closeButton || !window.bootstrap?.Popover) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const popoverElement = closeButton.closest(".popover");
    const popoverId = popoverElement?.id;

    if (!popoverId) {
        return;
    }

    const triggerButton = document.querySelector(`[aria-describedby="${popoverId}"]`);
    closeMeasurementPopover(triggerButton, { restoreFocus: true });
});

// These renderers draw the different answer UIs the quiz can show.
function renderOptions(question) {
    appendFieldGuidance(optionsContainer, question);

    question.options.forEach(option => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "option-btn";
        button.textContent = option.text;
        button.addEventListener("click", () => selectAnswer(question, option));
        optionsContainer.appendChild(button);
    });
}

function renderNumberSelect(question) {
    const wrapper = document.createElement("div");
    wrapper.className = "input-panel";

    appendFieldGuidance(wrapper, question);

    const select = document.createElement("select");
    select.className = "form-select quiz-select";
    select.setAttribute("aria-label", question.question);
    
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = question.placeholder || getText("selectValue");
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (let value = question.min; value <= question.max; value += question.step || 1) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value} ${question.unit || ""}`.trim();
        select.appendChild(option);
    }

    const actions = document.createElement("div");
    actions.className = "input-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary continue-btn";
    button.textContent = getText("continue");
    button.disabled = true;
    button.addEventListener("click", () => {
        if (select.value) {
            selectAnswer(question, buildNumericAnswer(question, Number(select.value)));
        }
    });

    select.addEventListener("change", () => {
        button.disabled = !select.value;
    });

    wrapper.appendChild(select);

    if (shouldOfferAverageFallback(question)) {
        const idkButton = document.createElement("button");
        idkButton.type = "button";
        idkButton.className = "btn btn-outline-primary continue-btn input-secondary-btn";
        idkButton.textContent = getText("idkOption");
        idkButton.addEventListener("click", () => {
            const numericValue = getAverageNumericValue(question);

            if (numericValue === null) {
                return;
            }

            selectAnswer(question, buildNumericAnswer(question, numericValue, { usedAverageFallback: true }));
        });

        actions.appendChild(idkButton);
    }

    actions.appendChild(button);
    wrapper.appendChild(actions);
    optionsContainer.appendChild(wrapper);
}

function renderNumberInput(question) {
    const wrapper = document.createElement("div");
    wrapper.className = "input-panel";

    appendFieldGuidance(wrapper, question);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control quiz-input";
    input.inputMode = "numeric";
    input.placeholder = question.placeholder || getText("enterValue");
    input.min = String(question.min);
    input.max = String(question.max);
    input.step = String(question.step || 1);
    input.setAttribute("aria-label", question.question);

    const errorText = document.createElement("p");
    errorText.className = "field-error d-none";
    errorText.textContent = getText("invalidNumber");

    const actions = document.createElement("div");
    actions.className = "input-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary continue-btn";
    button.textContent = getText("continue");
    button.disabled = true;
    button.addEventListener("click", () => {
        const numericValue = Number(input.value);
        const isInvalidValue = input.value === ""
            || !Number.isFinite(numericValue)
            || numericValue < Number(question.min)
            || numericValue > Number(question.max);

        errorText.classList.toggle("d-none", !isInvalidValue);

        if (isInvalidValue) {
            return;
        }

        selectAnswer(question, buildNumericAnswer(question, numericValue));
    });

    if (shouldOfferAverageFallback(question)) {
        const idkButton = document.createElement("button");
        idkButton.type = "button";
        idkButton.className = "btn btn-outline-primary continue-btn input-secondary-btn";
        idkButton.textContent = getText("idkOption");
        idkButton.addEventListener("click", () => {
            const numericValue = getAverageNumericValue(question);

            if (numericValue === null) {
                return;
            }

            selectAnswer(question, buildNumericAnswer(question, numericValue, { usedAverageFallback: true }));
        });

        actions.appendChild(idkButton);
    }

    input.addEventListener("input", () => {
        errorText.classList.add("d-none");
        button.disabled = input.value === "";
    });

    actions.appendChild(button);
    wrapper.appendChild(input);
    wrapper.appendChild(errorText);
    wrapper.appendChild(actions);
    optionsContainer.appendChild(wrapper);
}

// Normalizes numeric answers so the scoring code can treat them consistently.
function buildNumericAnswer(question, numericValue, { usedAverageFallback = false } = {}) {
    return {
        text: usedAverageFallback ? getText("idkOption") : `${numericValue} ${question.unit || ""}`.trim(),
        scoreValue: question.scoreValue || 0,
        numericValue,
        scoreType: question.scoreType,
        usedAverageFallback
    };
}

//"I don't know" fallback based on a midpoint value.
function shouldOfferAverageFallback(question) {
    return PRIMARY_MODEL === "beta" && betaAverageFallbackScoreTypes.has(question.scoreType);
}

function getAverageNumericValue(question) {
    const min = Number(question.min);
    const max = Number(question.max);
    const step = Number(question.step) || 1;

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return null;
    }

    const average = (min + max) / 2;
    const steppedAverage = Math.round((average - min) / step) * step + min;
    const clampedValue = Math.min(max, Math.max(min, steppedAverage));
    return Number(clampedValue.toFixed(2));
}

// These functions move through the quiz and keep enough history for the Previous button.
function selectAnswer(question, answer) {
    answers[question.id] = answer;
    answerHistory.push(question.id);
    
    const nextId = answer.next || question.next;
    currentQuestionId = nextId;
    
    setTimeout(() => {
        loadQuestion();
    }, 250);
}

function goToPreviousQuestion() {
    if (answerHistory.length > 0) {
        const prevQuestionId = answerHistory.pop();
        delete answers[prevQuestionId];
        currentQuestionId = prevQuestionId;
        loadQuestion();
    }
}

function updatePreviousButton() {
    const shouldShow = answerHistory.length > 0;
    previousButtonElement.textContent = getText("previous");
    previousButtonElement.classList.toggle("d-none", !shouldShow);
}

// Updates the short encouragement message shown on the result screen.
function updateResultEncouragement(riskKey) {
    if (!resultEncouragementElement) {
        return;
    }

    resultEncouragementElement.textContent = getText(`${riskKey}PopupMessage`);
}

// This is the current progress-step estimate used by the tracker bar.
function getTotalQuestionCount() {
    // Simple approximation - could be made more accurate
    return 8;
}

// Builds the final advice sentence shown under the risk result.
function updateRiskAdvice(riskKey) {
    if (!riskAdviceElement) {
        return;
    }

    const riskLabel = getText(`${riskKey}Label`).toLocaleLowerCase(getCurrentLanguage());

    if (getCurrentLanguage() === "ar") {
        riskAdviceElement.textContent = `تشير نتيجتك الحالية إلى خطر ${riskLabel} للإصابة بمقدمات السكري.`;
        return;
    }

    riskAdviceElement.textContent = getText("riskAdviceTemplate").replace("{risk}", riskLabel);
}

function normalizeRiskKey(label) {
    const normalizedLabel = String(label || "").toLowerCase();

    if (normalizedLabel === "moderate") {
        return "moderate";
    }

    if (normalizedLabel === "high") {
        return "high";
    }

    return "low";
}

function formatLocalizedNumber(value, maximumFractionDigits = 0) {
    const locale = getCurrentLanguage() === "ar" ? "ar" : "en";

    return new Intl.NumberFormat(locale, {
        maximumFractionDigits
    }).format(value);
}

function formatRiskBandValue(value, modelKey) {
    if (modelKey === "beta") {
        return `${formatLocalizedNumber(value * 100, 2)}%`;
    }

    return formatLocalizedNumber(value, 2);
}

function formatRiskBandRange(band, modelKey) {
    const minText = formatRiskBandValue(band.min ?? 0, modelKey);

    if (band.max === undefined || band.max === null) {
        return `${minText}+`;
    }

    return `${minText} - ${formatRiskBandValue(band.max, modelKey)}`;
}

function getRiskRangesLabel() {
    if (getCurrentLanguage() === "ar") {
        return getText("rangeLabel") || "\u0646\u0637\u0627\u0642\u0627\u062a \u0627\u0644\u062e\u0637\u0631:";
    }

    return getText("rangeLabel") || "Risk ranges:";
}

function renderRiskRanges(modelKey, activeRiskKey) {
    if (!finalScoreLabelElement || !riskRangesElement) {
        return;
    }

    const bands = scoreConfig?.[modelKey]?.riskCategories || [];
    const rangeItems = document.createDocumentFragment();

    finalScoreLabelElement.textContent = getRiskRangesLabel();
    riskRangesElement.replaceChildren();

    bands.forEach((band) => {
        const riskKey = normalizeRiskKey(band.label);
        const item = document.createElement("div");
        const label = document.createElement("span");
        const value = document.createElement("span");

        item.className = "risk-range-item";
        if (riskKey === activeRiskKey) {
            item.classList.add("is-active");
        }

        label.className = `risk-range-item-label risk-${riskKey}`;
        label.textContent = getText(`${riskKey}Label`);

        value.className = "risk-range-item-value";
        value.textContent = formatRiskBandRange(band, modelKey);

        item.append(label, value);
        rangeItems.appendChild(item);
    });

    riskRangesElement.appendChild(rangeItems);
}

// Combines all scoring outputs into the final result screen.
function showResults() {
    const quantizedScore = calculateQuantizedScore();
    const quantizedRisk = getQuantizedRisk(quantizedScore);
    const betaResult = calculateBetaResult();
    const bmiData = calculateBMI();
    let activeRiskKey = quantizedRisk.key;

    progressBar.style.width = "100%";
    questionTracker.textContent = getText("complete");
    previousButtonElement.classList.add("d-none");

    // Show results based on primary model
    if (PRIMARY_MODEL === "quantized") {
        riskLevelTextElement.textContent = `${getText("riskHeading")} ${getText(quantizedRisk.key + "Label")}`;
        riskLevelTextElement.className = `mb-3 risk-status risk-${quantizedRisk.key}`;
        updateRiskAdvice(quantizedRisk.key);
        renderRiskRanges("quantized", quantizedRisk.key);
    } else if (betaResult) {
        activeRiskKey = betaResult.risk.key;
        riskLevelTextElement.textContent = `${getText("riskHeading")} ${getText(betaResult.risk.key + "Label")}`;
        riskLevelTextElement.className = `mb-3 risk-status risk-${betaResult.risk.key}`;
        updateRiskAdvice(betaResult.risk.key);
        renderRiskRanges("beta", betaResult.risk.key);
    } else {
        // Fallback to quantized
        riskLevelTextElement.textContent = `${getText("riskHeading")} ${getText(quantizedRisk.key + "Label")}`;
        riskLevelTextElement.className = `mb-3 risk-status risk-${quantizedRisk.key}`;
        updateRiskAdvice(quantizedRisk.key);
        renderRiskRanges("quantized", quantizedRisk.key);
    }

    updateResultEncouragement(activeRiskKey);

    // BMI Summary
    if (bmiData.value) {
        const bmiLabel = getText(bmiData.labelKey);
        bmiSummaryElement.textContent = getText("bmiTemplate")
            .replace("{value}", bmiData.value.toFixed(1))
            .replace("{category}", bmiLabel);
    } else {
        bmiSummaryElement.textContent = getText("bmiUnavailable");
    }

    quizWrapper.classList.add("d-none");
    resultWrapper.classList.remove("d-none");
}

// These functions contain the actual scoring logic used by the quiz.
function calculateQuantizedScore() {
    let score = 0;
    
    // Add basic scores from answers
    Object.values(answers).forEach(answer => {
        if (answer.scoreValue && !["bmi_height", "bmi_weight", "sbp_manual", "dbp_manual", "beta_age", "beta_waist", "beta_systolic", "beta_diastolic"].includes(answer.scoreType)) {
            score += answer.scoreValue;
        }
    });

    // Add BMI score
    const bmi = calculateBMI();
    if (bmi.value) {
        const bmiBands = scoreConfig.quantized.bmiScoring.bands;
        const band = bmiBands.find(b => bmi.value >= b.min && (b.max === undefined || bmi.value <= b.max));
        if (band) score += band.scoreValue;
    }

    // Add blood pressure scores
    const systolic = getNumericValue(["sbp_manual", "beta_systolic"]);
    const diastolic = getNumericValue(["dbp_manual", "beta_diastolic"]);
    
    if (systolic) {
        const band = scoreConfig.quantized.bloodPressureScoring.systolic.bands.find(b => 
            systolic >= b.min && (b.max === undefined || systolic <= b.max));
        if (band) score += band.scoreValue;
    }
    
    if (diastolic) {
        const band = scoreConfig.quantized.bloodPressureScoring.diastolic.bands.find(b => 
            diastolic >= b.min && (b.max === undefined || diastolic <= b.max));
        if (band) score += band.scoreValue;
    }

    return score;
}

function calculateBetaResult() {
    const age = getNumericValue(["beta_age"]);
    const waist = getNumericValue(["beta_waist"]);
    const systolic = getNumericValue(["beta_systolic"]);
    const diastolic = getNumericValue(["beta_diastolic"]);
    const bmi = calculateBMI().value;
    const gender = answers.q1_gender?.betaValue !== undefined ? answers.q1_gender.betaValue : 
                  (answers.q1_gender?.text?.toLowerCase().includes("male") ? 1 : 0);

    if (!age || !waist || !systolic || !diastolic || !bmi) return null;

    const betas = scoreConfig.beta.betas;
    const z = scoreConfig.beta.intercept +
              (betas.age * age) +
              (betas.bmi * bmi) +
              (betas.waist * waist) +
              (betas.systolic * systolic) +
              (betas.diastolic * diastolic) +
              (betas.gender * gender);

    const probability = 1 / (1 + Math.exp(-z));
    const risk = getRiskFromBands(probability, scoreConfig.beta.riskCategories);

    return { probability, risk };
}

function calculateBMI() {
    const height = getNumericValue(["bmi_height"]);
    const weight = getNumericValue(["bmi_weight"]);
    
    if (!height || !weight) return { value: null, labelKey: null };
    
    const bmi = weight / ((height / 100) ** 2);
    const bands = scoreConfig.quantized.bmiScoring.bands;
    const band = bands.find(b => bmi >= b.min && (b.max === undefined || bmi <= b.max));
    
    let labelKey = "bmiNormal";
    if (band?.label.toLowerCase().includes("obese")) labelKey = "bmiObese";
    else if (band?.label.toLowerCase().includes("overweight")) labelKey = "bmiOverweight";
    
    return { value: bmi, labelKey };
}

function getQuantizedRisk(score) {
    const bands = scoreConfig.quantized.riskCategories;
    const band = bands.find(b => score >= b.min && (b.max === undefined || score <= b.max));
    return { key: normalizeRiskKey(band?.label) };
}

function getRiskFromBands(value, bands) {
    const band = bands.find(b => value >= b.min && (b.max === undefined || value <= b.max));
    return { key: normalizeRiskKey(band?.label) };
}

function getNumericValue(scoreTypes) {
    for (const scoreType of scoreTypes) {
        const answer = Object.values(answers).find(a => a.scoreType === scoreType);
        if (answer?.numericValue) return answer.numericValue;
    }
    return null;
}

// Re-renders visible quiz text when the shared site language changes.
window.addEventListener("prisq-language-change", refreshQuizLanguage);
